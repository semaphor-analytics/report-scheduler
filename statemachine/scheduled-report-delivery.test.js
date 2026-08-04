const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');

const definition = JSON.parse(
  readFileSync(join(__dirname, 'scheduled-report-delivery.asl.json'), 'utf8'),
);

test('routes typed attachment failures to actionable status persistence', () => {
  const itemStates =
    definition.States.GenerateAttachments.ItemProcessor.States;

  assert.equal(
    itemStates.GenerateSingleAttachment.Next,
    'EvaluateGeneratedAttachment',
  );
  assert.equal(
    itemStates.FailTypedAttachmentRender.Error,
    'SemaphorDeliveryBlockingRenderError',
  );
  assert.equal(
    itemStates.FailTypedAttachmentRender.CausePath,
    '$.statusMessage',
  );
  assert.equal(
    definition.States.ClassifyAttachmentFailure.Choices[0].Next,
    'UpdateStatusFailedFromTypedRender',
  );
  assert.equal(
    definition.States.UpdateStatusFailedFromTypedRender.Parameters.Payload[
      'status.$'
    ],
    '$.deliveryError.Cause',
  );
  assert.equal(
    definition.States.UpdateStatusFailedFromException.Parameters.Payload.status,
    'error',
  );
});
