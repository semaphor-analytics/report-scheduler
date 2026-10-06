const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');

const definition = JSON.parse(
  readFileSync(join(__dirname, 'export.asl.json'), 'utf8'),
);

test('projects each chunk item totals request and retains top-level state', () => {
  assert.equal(
    definition.States.ProcessChunks.Parameters['tableTotalsRequest.$'],
    '$$.Map.Item.Value.tableTotalsRequest',
  );
  assert.equal(definition.States.ProcessChunks.ResultPath, '$.chunkResults');
});

test('retries MarkExportFailed, so a failed fail-call ends the execution FAILED after retries (MX-D7)', () => {
  assert.deepEqual(definition.States.MarkExportFailed.Retry, [
    { ErrorEquals: ['States.ALL'], IntervalSeconds: 2, MaxAttempts: 3, BackoffRate: 2 },
  ]);
  assert.equal(definition.States.MarkExportFailed.Catch, undefined);
});
