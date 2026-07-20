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
