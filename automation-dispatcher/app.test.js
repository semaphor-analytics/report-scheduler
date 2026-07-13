const assert = require('node:assert/strict');
const { afterEach, beforeEach, test } = require('node:test');
const { handler, _private } = require('./app');

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

beforeEach(() => {
  process.env.SEMAPHOR_APP_URL = 'https://app.example.com';
  process.env.LAMBDA_API_KEY = 'test-api-key';
  process.env.AUTOMATION_EXECUTOR_MODE = 'http';
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

test('fetches app-owned dispatch targets without environment kind or org configuration', async () => {
  let request;
  global.fetch = async (url, init) => {
    request = { url, init };
    return response({
      orgIds: [' org-1 ', 'org-1'],
      kinds: ['report', 'BRIEFING'],
    });
  };

  const targets = await _private.fetchDispatchTargets(
    process.env.SEMAPHOR_APP_URL,
    process.env.LAMBDA_API_KEY
  );

  assert.deepEqual(targets, {
    orgIds: ['org-1'],
    kinds: ['REPORT', 'BRIEFING'],
  });
  assert.equal(
    request.url,
    'https://app.example.com/api/v1/automations/internal/dispatch-targets'
  );
  assert.equal(request.init.headers['X-API-Key'], 'test-api-key');
});

test('an organization child invocation dispatches only that organization', async () => {
  const paths = [];
  global.fetch = async (url) => {
    const path = new URL(url).pathname;
    paths.push(path);

    if (path.endsWith('/claim-due')) {
      return response({
        rules: [
          {
            id: 'briefing-1',
            kind: 'BRIEFING',
            orgId: 'org-1',
            tenantId: null,
            projectId: 'project-1',
            nextRunAt: '2026-07-12T14:00:00.000Z',
            name: 'Daily Briefing',
            description: null,
            timezone: 'America/Chicago',
            scheduleExpr: '0 9 * * *',
            jobConfig: { kind: 'BRIEFING' },
            deliveryConfig: { channels: ['EMAIL'] },
            workflowDef: null,
          },
        ],
      });
    }
    if (path === '/api/v1/automations/internal/runs') {
      return response({
        run: {
          id: 'run-1',
          ruleId: 'briefing-1',
          status: 'QUEUED',
          scheduledFor: '2026-07-12T14:00:00.000Z',
        },
      });
    }
    if (path.endsWith('/runs/run-1/start')) {
      return response({
        transitionApplied: true,
        run: { id: 'run-1', status: 'RUNNING' },
      });
    }
    if (path.endsWith('/execute')) {
      return response({ accepted: true });
    }

    throw new Error(`Unexpected path: ${path}`);
  };

  const result = await handler(
    {
      type: 'automation-org-dispatch',
      coordinatorInvocationId: 'coordinator-1',
      orgId: 'org-1',
      kinds: ['BRIEFING'],
    },
    { awsRequestId: 'request-1' }
  );
  const body = JSON.parse(result.body);

  assert.equal(result.statusCode, 200);
  assert.equal(body.summary.orgResults[0].results[0].status, 'dispatched');
  assert.deepEqual(paths, [
    '/api/v1/automations/internal/claim-due',
    '/api/v1/automations/internal/runs',
    '/api/v1/automations/internal/runs/run-1/start',
    '/api/v1/automations/internal/execute',
  ]);
});

test('coordinator fans out one bounded asynchronous invocation per organization', async () => {
  const orgIds = Array.from({ length: 25 }, (_, index) => `org-${index + 1}`);
  const calls = [];
  let active = 0;
  let maxActive = 0;

  global.fetch = async (url) => {
    const path = new URL(url).pathname;
    assert.equal(path, '/api/v1/automations/internal/dispatch-targets');
    return response({
      orgIds,
      kinds: ['REPORT', 'CACHE_REFRESH', 'BRIEFING'],
    });
  };

  const coordinator = _private.createHandler({
    invokeOrg: async (input) => {
      calls.push(input);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return { orgId: input.orgId, status: 'accepted' };
    },
  });

  const result = await coordinator(
    {},
    {
      awsRequestId: 'coordinator-1',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:dispatcher',
    }
  );
  const body = JSON.parse(result.body);

  assert.equal(result.statusCode, 200);
  assert.equal(calls.length, orgIds.length);
  assert.ok(maxActive > 1);
  assert.ok(maxActive <= _private.FANOUT_CONCURRENCY);
  assert.deepEqual(calls.map((call) => call.orgId), orgIds);
  assert.ok(calls.every((call) => call.coordinatorInvocationId === 'coordinator-1'));
  assert.ok(calls.every((call) => call.kinds.includes('EXPORT') === false));
  assert.equal(body.summary.fanoutResults.length, orgIds.length);
});
