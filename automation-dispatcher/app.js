const DEFAULT_BATCH_SIZE = 60;
const DEFAULT_LEASE_MINUTES = 5;
const DEFAULT_KINDS = ['REPORT', 'ALERT', 'CACHE_REFRESH'];
const DEFAULT_EXECUTOR_PATH = '/api/v1/automations/internal/execute';
const AWS = require('aws-sdk');
const stepFunctions = new AWS.StepFunctions();

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }

  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  return defaultValue;
}

function parseInteger(value, defaultValue) {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed)) {
    return defaultValue;
  }
  return parsed;
}

function parseCsvList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

function resolveOrgIds(event) {
  const fromEvent = [];

  if (event && typeof event === 'object') {
    if (typeof event.orgId === 'string' && event.orgId.trim()) {
      fromEvent.push(event.orgId.trim());
    }

    if (Array.isArray(event.orgIds)) {
      fromEvent.push(...event.orgIds.filter((v) => typeof v === 'string').map((v) => v.trim()));
    }

    if (event.detail && typeof event.detail === 'object') {
      if (typeof event.detail.orgId === 'string' && event.detail.orgId.trim()) {
        fromEvent.push(event.detail.orgId.trim());
      }

      if (Array.isArray(event.detail.orgIds)) {
        fromEvent.push(
          ...event.detail.orgIds
            .filter((v) => typeof v === 'string')
            .map((v) => v.trim())
        );
      }
    }
  }

  if (fromEvent.length > 0) {
    return unique(fromEvent.filter(Boolean));
  }

  return unique(parseCsvList(process.env.AUTOMATION_DISPATCH_ORG_IDS));
}

function resolveKinds(event) {
  const fromEvent = [];

  if (event && typeof event === 'object') {
    if (typeof event.kind === 'string' && event.kind.trim()) {
      fromEvent.push(event.kind.trim().toUpperCase());
    }

    if (Array.isArray(event.kinds)) {
      fromEvent.push(
        ...event.kinds
          .filter((v) => typeof v === 'string')
          .map((v) => v.trim().toUpperCase())
      );
    }

    if (event.detail && typeof event.detail === 'object') {
      if (typeof event.detail.kind === 'string' && event.detail.kind.trim()) {
        fromEvent.push(event.detail.kind.trim().toUpperCase());
      }

      if (Array.isArray(event.detail.kinds)) {
        fromEvent.push(
          ...event.detail.kinds
            .filter((v) => typeof v === 'string')
            .map((v) => v.trim().toUpperCase())
        );
      }
    }
  }

  const configuredKinds = parseCsvList(process.env.AUTOMATION_DISPATCH_KINDS)
    .map((k) => k.toUpperCase());

  const values = fromEvent.length > 0 ? fromEvent : (configuredKinds.length > 0 ? configuredKinds : DEFAULT_KINDS);
  return unique(values).filter((k) => DEFAULT_KINDS.includes(k));
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

    const execution = await stepFunctions
      .startExecution({
        stateMachineArn,
        name: buildExecutionName(payload.runId),
        input: JSON.stringify(payload),
      })
      .promise();

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

exports.handler = async (event = {}, context = {}) => {
  const baseUrl = process.env.SEMAPHOR_APP_URL;
  const apiKey = process.env.LAMBDA_API_KEY;
  const enabled = parseBoolean(process.env.AUTOMATION_DISPATCH_ENABLED, false);

  if (!baseUrl || !apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Missing required configuration',
        required: ['SEMAPHOR_APP_URL', 'LAMBDA_API_KEY'],
      }),
    };
  }

  if (!enabled) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Automation dispatcher disabled',
        hint: 'Set AUTOMATION_DISPATCH_ENABLED=true to activate',
      }),
    };
  }

  const orgIds = resolveOrgIds(event);
  if (orgIds.length === 0) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'No orgIds resolved for dispatch',
        hint: 'Provide event.orgId/event.orgIds or AUTOMATION_DISPATCH_ORG_IDS',
      }),
    };
  }

  const kinds = resolveKinds(event);
  if (kinds.length === 0) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'No enabled kinds to dispatch',
      }),
    };
  }

  const batchSize = parseInteger(process.env.AUTOMATION_BATCH_SIZE, DEFAULT_BATCH_SIZE);
  const leaseMinutes = parseInteger(process.env.AUTOMATION_LEASE_MINUTES, DEFAULT_LEASE_MINUTES);
  const invocationId = context.awsRequestId || `local-${Date.now()}`;

  const summary = {
    invocationId,
    orgIds,
    kinds,
    orgResults: [],
  };

  for (const orgId of orgIds) {
    for (const kind of kinds) {
      try {
        const result = await processOrgKind({
          baseUrl,
          apiKey,
          orgId,
          kind,
          invocationId,
          batchSize,
          leaseMinutes,
        });
        summary.orgResults.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[automation-dispatcher] Org/kind dispatch failed', {
          orgId,
          kind,
          error: message,
        });

        summary.orgResults.push({
          orgId,
          kind,
          claimedCount: 0,
          error: message,
          results: [],
        });
      }
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Automation dispatch cycle complete',
      summary,
    }),
  };
};
