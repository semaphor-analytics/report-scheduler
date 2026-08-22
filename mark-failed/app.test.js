const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractErrorMessage,
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
