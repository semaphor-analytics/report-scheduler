const { InvokeCommand, LambdaClient } = require('@aws-sdk/client-lambda');
const { SFNClient, StartExecutionCommand } = require('@aws-sdk/client-sfn');

const DEFAULT_BATCH_SIZE = 60;
const DEFAULT_LEASE_MINUTES = 5;
const DEFAULT_EXECUTOR_PATH = '/api/v1/automations/internal/execute';
const FANOUT_CONCURRENCY = 10;
const ORG_DISPATCH_EVENT_TYPE = 'automation-org-dispatch';

function parseInteger(value, defaultValue) {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed)) {
    return defaultValue;
  }
  return parsed;
}

function getExecutorPath(kind) {
  const unifiedPath = (process.env.AUTOMATION_EXECUTOR_PATH || '').trim();
  if (unifiedPath) {
    return unifiedPath;
  }

  if (kind === 'REPORT') {
    return process.env.REPORT_EXECUTOR_PATH || '';
  }

  if (kind === 'ALERT') {
    return process.env.ALERT_EXECUTOR_PATH || '';
  }

  if (kind === 'CACHE_REFRESH') {
    return process.env.CACHE_REFRESH_EXECUTOR_PATH || '';
  }

  return DEFAULT_EXECUTOR_PATH;
}

function buildExecutionName(runId) {
  const raw = `run-${runId}-${Date.now()}`;
  return raw.replace(/[^A-Za-z0-9-_]/g, '-').slice(0, 80);
}

async function postInternal(baseUrl, apiKey, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify(body ?? {}),
  });

  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!response.ok) {
    const message = payload && payload.error
      ? payload.error
      : `HTTP ${response.status} for ${path}`;
    const error = new Error(message);
    error.statusCode = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function fetchDispatchTargets(baseUrl, apiKey) {
  const payload = await postInternal(
    baseUrl,
    apiKey,
    '/api/v1/automations/internal/dispatch-targets',
    {}
  );
  const orgIds = Array.isArray(payload?.orgIds)
    ? payload.orgIds.filter((value) => typeof value === 'string' && value.trim())
    : null;
  const kinds = Array.isArray(payload?.kinds)
    ? payload.kinds.filter((value) => typeof value === 'string' && value.trim())
    : null;

  if (!orgIds || !kinds || kinds.length === 0) {
    throw new Error('Dispatch targets response is missing orgIds or kinds');
  }

  return {
    orgIds: [...new Set(orgIds.map((value) => value.trim()))],
    kinds: [...new Set(kinds.map((value) => value.trim().toUpperCase()))],
  };
}

async function failRun(baseUrl, apiKey, runId, errorMessage) {
  try {
    await postInternal(baseUrl, apiKey, `/api/v1/automations/internal/runs/${runId}/fail`, {
      error: errorMessage,
    });
  } catch (error) {
    console.error('[automation-dispatcher] Failed to mark run as failed', {
      runId,
      error: error.message,
    });
  }
}

async function dispatchRuleExecution(baseUrl, apiKey, kind, payload) {
  const mode = (process.env.AUTOMATION_EXECUTOR_MODE || 'http').trim().toLowerCase();

  if (mode === 'stepfunctions') {
    const stateMachineArn = process.env.AUTOMATION_STATE_MACHINE_ARN;
    if (!stateMachineArn) {
      throw new Error('AUTOMATION_STATE_MACHINE_ARN is required for stepfunctions mode');
    }

    const stepFunctions = new SFNClient({});
    const execution = await stepFunctions.send(
      new StartExecutionCommand({
        stateMachineArn,
        name: buildExecutionName(payload.runId),
        input: JSON.stringify(payload),
      })
    );

    return {
      accepted: true,
      mode: 'stepfunctions',
      executionArn: execution.executionArn,
      startDate: execution.startDate,
    };
  }

  if (mode !== 'http') {
    throw new Error(`Unsupported AUTOMATION_EXECUTOR_MODE: ${mode}`);
  }

  const path = getExecutorPath(kind);
  if (!path) {
    throw new Error(`No executor path configured for kind ${kind}`);
  }

  const response = await postInternal(baseUrl, apiKey, path, payload);

  if (response && response.accepted === false) {
    throw new Error(response.error || `Executor rejected run for ${kind}`);
  }

  return response;
}

async function processClaimedRule({
  baseUrl,
  apiKey,
  kind,
  orgId,
  rule,
  invocationId,
}) {
  let runId = null;

  try {
    const scheduledFor = rule.nextRunAt || new Date().toISOString();

    const runResponse = await postInternal(
      baseUrl,
      apiKey,
      '/api/v1/automations/internal/runs',
      {
        ruleId: rule.id,
        scheduledFor,
      }
    );

    const run = runResponse?.run || runResponse;
    if (!run?.id) {
      throw new Error(`Run creation response missing id for rule ${rule.id}`);
    }

    runId = run.id;

    const startedResponse = await postInternal(
      baseUrl,
      apiKey,
      `/api/v1/automations/internal/runs/${runId}/start`,
      {}
    );

    const startedRun = startedResponse?.run || startedResponse;
    if (startedResponse?.transitionApplied !== true || startedRun?.status !== 'RUNNING') {
      console.log('[automation-dispatcher] Skipping dispatch for non-RUNNING run', {
        ruleId: rule.id,
        runId,
        status: startedRun?.status,
      });
      return {
        ruleId: rule.id,
        runId,
        status: 'skipped',
        reason: `Run status is ${startedRun?.status || 'unknown'}`,
      };
    }

    await dispatchRuleExecution(baseUrl, apiKey, kind, {
      ruleId: rule.id,
      runId,
      kind,
      orgId,
      tenantId: rule.tenantId || null,
      projectId: rule.projectId,
      scheduledFor,
      invocationId,
      ruleSnapshot: {
        name: rule.name,
        description: rule.description,
        timezone: rule.timezone,
        scheduleExpr: rule.scheduleExpr,
        jobConfig: rule.jobConfig,
        deliveryConfig: rule.deliveryConfig,
        workflowDef: rule.workflowDef,
      },
    });

    return {
      ruleId: rule.id,
      runId,
      status: 'dispatched',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[automation-dispatcher] Rule dispatch failed', {
      ruleId: rule.id,
      runId,
      kind,
      orgId,
      error: message,
    });

    if (runId) {
      await failRun(baseUrl, apiKey, runId, `DISPATCH_FAILED: ${message}`);
    }

    return {
      ruleId: rule.id,
      runId,
      status: 'failed',
      error: message,
    };
  }
}

async function processOrgKind({
  baseUrl,
  apiKey,
  orgId,
  kind,
  invocationId,
  batchSize,
  leaseMinutes,
}) {
  const dispatcherId = `${invocationId}-${orgId}-${kind.toLowerCase()}`;

  const claimPayload = {
    orgId,
    kinds: [kind],
    batchSize,
    leaseMinutes,
    dispatcherId,
  };

  const claimResponse = await postInternal(
    baseUrl,
    apiKey,
    '/api/v1/automations/internal/claim-due',
    claimPayload
  );

  const rules = Array.isArray(claimResponse?.rules)
    ? claimResponse.rules
    : [];

  console.log('[automation-dispatcher] Claimed rules', {
    orgId,
    kind,
    claimedCount: rules.length,
  });

  const results = [];
  for (const rule of rules) {
    const result = await processClaimedRule({
      baseUrl,
      apiKey,
      kind,
      orgId,
      rule,
      invocationId,
    });
    results.push(result);
  }

  return {
    orgId,
    kind,
    claimedCount: rules.length,
    results,
  };
}

function parseOrgDispatchEvent(event) {
  if (
    event?.type !== ORG_DISPATCH_EVENT_TYPE
    || typeof event.orgId !== 'string'
    || !event.orgId.trim()
    || !Array.isArray(event.kinds)
  ) {
    return null;
  }

  const kinds = [...new Set(
    event.kinds
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim().toUpperCase())
  )];
  if (kinds.length === 0) {
    return null;
  }

  return {
    coordinatorInvocationId: typeof event.coordinatorInvocationId === 'string'
      ? event.coordinatorInvocationId
      : null,
    orgId: event.orgId.trim(),
    kinds,
  };
}

async function mapWithConcurrency(values, concurrency, worker) {
  if (values.length === 0) {
    return [];
  }

  const results = new Array(values.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(values[index], index);
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), values.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

async function invokeOrgCycle(input, client = new LambdaClient({})) {
  const response = await client.send(new InvokeCommand({
    FunctionName: input.functionName,
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify({
      type: ORG_DISPATCH_EVENT_TYPE,
      coordinatorInvocationId: input.coordinatorInvocationId,
      orgId: input.orgId,
      kinds: input.kinds,
    })),
  }));

  if (response.StatusCode !== 202) {
    throw new Error(`Async invocation for organization ${input.orgId} returned ${response.StatusCode}`);
  }

  return { orgId: input.orgId, status: 'accepted' };
}

async function fanOutOrgCycles({ functionName, invocationId, orgIds, kinds, invokeOrg }) {
  const results = await mapWithConcurrency(
    orgIds,
    FANOUT_CONCURRENCY,
    async (orgId) => {
      try {
        return await invokeOrg({
          functionName,
          coordinatorInvocationId: invocationId,
          orgId,
          kinds,
        });
      } catch (error) {
        return {
          orgId,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  const failures = results.filter((result) => result.status === 'failed');
  if (failures.length > 0) {
    console.error('[automation-dispatcher] Organization fanout failed', { failures });
    throw new Error(`Failed to invoke ${failures.length} organization dispatch cycle(s)`);
  }

  return results;
}

async function runOrgCycle({ baseUrl, apiKey, event, invocationId }) {
  const batchSize = parseInteger(process.env.AUTOMATION_BATCH_SIZE, DEFAULT_BATCH_SIZE);
  const leaseMinutes = parseInteger(process.env.AUTOMATION_LEASE_MINUTES, DEFAULT_LEASE_MINUTES);
  const summary = {
    invocationId,
    coordinatorInvocationId: event.coordinatorInvocationId,
    orgId: event.orgId,
    kinds: event.kinds,
    orgResults: [],
  };

  for (const kind of event.kinds) {
    try {
      summary.orgResults.push(await processOrgKind({
        baseUrl,
        apiKey,
        orgId: event.orgId,
        kind,
        invocationId,
        batchSize,
        leaseMinutes,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[automation-dispatcher] Org/kind dispatch failed', {
        orgId: event.orgId,
        kind,
        error: message,
      });
      summary.orgResults.push({
        orgId: event.orgId,
        kind,
        claimedCount: 0,
        error: message,
        results: [],
      });
    }
  }

  return summary;
}

function createHandler({ invokeOrg = invokeOrgCycle } = {}) {
  return async (event = {}, context = {}) => {
    const baseUrl = process.env.SEMAPHOR_APP_URL;
    const apiKey = process.env.LAMBDA_API_KEY;

    if (!baseUrl || !apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          message: 'Missing required configuration',
          required: ['SEMAPHOR_APP_URL', 'LAMBDA_API_KEY'],
        }),
      };
    }

    const invocationId = context.awsRequestId || `local-${Date.now()}`;
    const orgEvent = parseOrgDispatchEvent(event);
    if (event?.type === ORG_DISPATCH_EVENT_TYPE && !orgEvent) {
      throw new Error('Invalid organization dispatch event');
    }
    if (orgEvent) {
      const summary = await runOrgCycle({
        baseUrl,
        apiKey,
        event: orgEvent,
        invocationId,
      });
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Organization automation dispatch cycle complete',
          summary,
        }),
      };
    }

    const { orgIds, kinds } = await fetchDispatchTargets(baseUrl, apiKey);
    const functionName = context.invokedFunctionArn || process.env.AWS_LAMBDA_FUNCTION_NAME;
    if (orgIds.length > 0 && !functionName) {
      throw new Error('Unable to determine dispatcher function name for organization fanout');
    }
    const fanoutResults = await fanOutOrgCycles({
      functionName,
      invocationId,
      orgIds,
      kinds,
      invokeOrg,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Automation organization fanout complete',
        summary: { invocationId, orgIds, kinds, fanoutResults },
      }),
    };
  };
}

exports.handler = createHandler();

exports._private = {
  FANOUT_CONCURRENCY,
  createHandler,
  fanOutOrgCycles,
  fetchDispatchTargets,
  mapWithConcurrency,
  parseOrgDispatchEvent,
};
