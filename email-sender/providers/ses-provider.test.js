const test = require('node:test');
const assert = require('node:assert/strict');

const sentRequests = [];

class FakeSes {
  sendRawEmail(request) {
    sentRequests.push(request);
    return {
      promise: async () => ({ MessageId: `ses-${sentRequests.length}` }),
    };
  }
}

const awsModulePath = require.resolve('aws-sdk');
const originalAwsModule = require.cache[awsModulePath];
require.cache[awsModulePath] = {
  id: awsModulePath,
  filename: awsModulePath,
  loaded: true,
  exports: { SES: FakeSes },
};

const { createSesProvider } = require('./ses-provider');

test.after(() => {
  if (originalAwsModule) {
    require.cache[awsModulePath] = originalAwsModule;
  } else {
    delete require.cache[awsModulePath];
  }
});

function message(overrides = {}) {
  return {
    from: 'Respark Reports <noreply@semaphor.cloud>',
    to: ['user@example.com'],
    subject: 'Weekly report',
    textBody: 'Report',
    htmlBody: '<p>Report</p>',
    attachments: [],
    ...overrides,
  };
}

test('unbranded SES send preserves the existing request shape', async () => {
  sentRequests.length = 0;
  const provider = createSesProvider();

  const result = await provider.send(message());

  assert.equal(result.success, true);
  assert.deepEqual(Object.keys(sentRequests[0]), ['RawMessage']);
  assert.doesNotMatch(
    sentRequests[0].RawMessage.Data.toString('utf8'),
    /^Reply-To:|^Bcc:/imu
  );
});

test('branded SES send carries Reply-To in MIME and BCC only in Destinations', async () => {
  sentRequests.length = 0;
  const provider = createSesProvider();

  const result = await provider.send(
    message({
      replyTo: 'reply@respark.com',
      bcc: 'archive@respark.com',
    })
  );

  assert.equal(result.success, true);
  assert.deepEqual(sentRequests[0].Destinations, [
    'user@example.com',
    'archive@respark.com',
  ]);
  const raw = sentRequests[0].RawMessage.Data.toString('utf8');
  assert.match(raw, /^Reply-To: reply@respark\.com$/imu);
  assert.doesNotMatch(raw, /^Bcc:/imu);
});
