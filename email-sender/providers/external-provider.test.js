const test = require('node:test');
const assert = require('node:assert/strict');

const { createExternalProvider } = require('./external-provider');

function createMessage(overrides = {}) {
  return {
    brandingVersion: null,
    from: 'Semaphor <noreply@semaphor.cloud>',
    fromName: null,
    fromAddress: 'noreply@semaphor.cloud',
    to: ['user@example.com'],
    replyTo: null,
    bcc: null,
    subject: 'Weekly report',
    textBody: 'Report',
    htmlBody: '<p>Report</p>',
    attachments: [],
    metadata: { scheduleId: null },
    ...overrides,
  };
}

function createProvider(overrides = {}) {
  return createExternalProvider({
    webhookUrl: 'https://mail.example.com/send',
    authSecret: 'test-secret',
    presignedUrlExpirySeconds: 900,
    s3: {
      getSignedUrl: () => 'https://s3.example.com/report',
    },
    ...overrides,
  });
}

test('unbranded external payload retains its existing exact object shape', async () => {
  const originalFetch = global.fetch;
  let requestBody;
  global.fetch = async (_url, init) => {
    requestBody = init.body;
    return new Response(
      JSON.stringify({ success: true, providerMessageId: 'external-1' })
    );
  };

  try {
    const result = await createProvider().send(createMessage());
    assert.equal(result.success, true);
    assert.deepEqual(JSON.parse(requestBody), {
      from: 'Semaphor <noreply@semaphor.cloud>',
      to: ['user@example.com'],
      subject: 'Weekly report',
      text: 'Report',
      html: '<p>Report</p>',
      attachments: [],
      metadata: { scheduleId: null },
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('version 2 external payload carries branded envelope fields', async () => {
  const originalFetch = global.fetch;
  let payload;
  global.fetch = async (_url, init) => {
    payload = JSON.parse(init.body);
    return new Response(
      JSON.stringify({ success: true, providerMessageId: 'external-1' })
    );
  };

  try {
    const result = await createProvider().send(
      createMessage({
        brandingVersion: 1,
        from: 'Respark Reports <noreply@semaphor.cloud>',
        fromName: 'Respark Reports',
        replyTo: 'reply@respark.com',
        bcc: 'archive@respark.com',
      })
    );
    assert.equal(result.success, true);
    assert.equal(payload.contractVersion, 2);
    assert.equal(payload.fromName, 'Respark Reports');
    assert.equal(payload.replyTo, 'reply@respark.com');
    assert.equal(payload.bcc, 'archive@respark.com');
  } finally {
    global.fetch = originalFetch;
  }
});
