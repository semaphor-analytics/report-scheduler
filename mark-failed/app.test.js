const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractErrorMessage,
  extractFailureReason,
  handler,
  normalizeExportFailureMessage,
} = require('./dist/app.js');

const actionableMessage =
  'Full-dataset SQL export cannot safely chunk an outer query with LIMIT and no stable ordering.';
const queryError = `Query failed (400): ${JSON.stringify({
  error: actionableMessage,
  requestId: 'request-1',
  sql: 'SELECT * FROM orders LIMIT 20000',
})}`;

test('extracts the actionable app error from a local runner failure', () => {
  assert.equal(
    extractErrorMessage({
      Error: 'LocalExportExecutionError',
      Cause: JSON.stringify({ errorMessage: queryError }),
    }),
    actionableMessage,
  );
});

test('extracts the actionable app error from a production Lambda failure', () => {
  assert.equal(
    extractErrorMessage({
      Error: 'ExportQueryRejectedError',
      Cause: JSON.stringify({ errorMessage: queryError }),
    }),
    actionableMessage,
  );
});

test('preserves an ordinary failure message without its orchestration type', () => {
  assert.equal(
    extractErrorMessage({
      Error: 'Error',
      Cause: JSON.stringify({ errorMessage: 'S3 upload failed' }),
    }),
    'S3 upload failed',
  );
});

test('fails safely when a query failure does not contain JSON', () => {
  assert.equal(
    normalizeExportFailureMessage('Query failed (400): invalid response'),
    'Query failed (400): invalid response',
  );
});

// MX-D7, MX-D17: MarkFailed fails loudly and forwards the app's reason unchanged.
const relayed = (reason) => ({
  Error: 'ExportQueryRejectedError',
  Cause: JSON.stringify({ errorMessage: JSON.stringify({ error: 'Matrix CSV exceeds the full export row limit.', reason }) }),
});

test('reads the app-issued reason and the app text from the worker relay envelope', () => {
  assert.equal(extractFailureReason(relayed('too_large')), 'too_large');
  assert.equal(extractErrorMessage(relayed('too_large')), 'Matrix CSV exceeds the full export row limit.');
});

test('has no reason when the worker relayed none, and never infers one', () => {
  assert.equal(extractFailureReason({ Error: 'Error', Cause: JSON.stringify({ errorMessage: 'Query failed (503): busy' }) }), undefined);
  assert.equal(extractFailureReason(undefined), undefined);
});

async function withFetch(impl, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return impl(); };
  try { return await run(calls); } finally { globalThis.fetch = original; }
}

test('forwards the reason to the fail endpoint', async () => {
  await withFetch(() => new Response('{"success":true}', { status: 200 }), async (calls) => {
    await handler({ jobId: 'job', exportToken: 't', error: relayed('query_failed') });
    assert.deepEqual(calls[0].body, { error: 'Matrix CSV exceeds the full export row limit.', reason: 'query_failed' });
  });
});

test('throws when the app did not record the failure, so Step Functions retries it', async () => {
  await withFetch(() => new Response('database unavailable', { status: 503 }), async () => {
    await assert.rejects(handler({ jobId: 'job', exportToken: 't', error: relayed('query_failed') }), /503/);
  });
});

test('throws on a network error instead of reporting success', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  try {
    await assert.rejects(handler({ jobId: 'job', exportToken: 't', error: relayed('query_failed') }), /fetch failed/);
  } finally { globalThis.fetch = original; }
});
