const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const sentEmails = [];

class FakeResend {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.emails = {
      send: async (message) => {
        sentEmails.push({
          apiKey: this.apiKey,
          message,
        });
        return {
          data: {
            id: `resend-${sentEmails.length}`,
          },
        };
      },
    };
  }
}

const resendModulePath = require.resolve('resend');
require.cache[resendModulePath] = {
  id: resendModulePath,
  filename: resendModulePath,
  loaded: true,
  exports: {
    Resend: FakeResend,
  },
};

const { handler } = require('./app');

function signedEvent(payload, secret = 'test-secret') {
  const rawBody = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  return {
    version: '2.0',
    requestContext: {
      http: {
        method: 'POST',
      },
    },
    headers: {
      'X-Semaphor-Timestamp': timestamp,
      'X-Semaphor-Signature': signature,
    },
    body: rawBody,
  };
}

test('body-only payloads send without attachments', async () => {
  const originalSecret = process.env.EMAIL_EXTERNAL_AUTH_SECRET;
  const originalResendApiKey = process.env.RESEND_API_KEY;
  process.env.EMAIL_EXTERNAL_AUTH_SECRET = 'test-secret';
  process.env.RESEND_API_KEY = 'resend-test-key';
  sentEmails.length = 0;

  try {
    const response = await handler(
      signedEvent({
        from: 'reports@example.com',
        to: ['ops@example.com'],
        subject: 'Dashboard Email Report',
        text: 'Body-only briefing email',
        html: '<p>Body-only briefing email</p>',
        attachments: [],
      })
    );

    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).providerMessageId, 'resend-1');
    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0].apiKey, 'resend-test-key');
    assert.deepEqual(sentEmails[0].message.attachments, []);
    assert.deepEqual(sentEmails[0].message.to, ['ops@example.com']);
  } finally {
    if (originalSecret === undefined) {
      delete process.env.EMAIL_EXTERNAL_AUTH_SECRET;
    } else {
      process.env.EMAIL_EXTERNAL_AUTH_SECRET = originalSecret;
    }
    if (originalResendApiKey === undefined) {
      delete process.env.RESEND_API_KEY;
    } else {
      process.env.RESEND_API_KEY = originalResendApiKey;
    }
  }
});

test('attachment payloads still require presignedUrl and name', async () => {
  const originalSecret = process.env.EMAIL_EXTERNAL_AUTH_SECRET;
  process.env.EMAIL_EXTERNAL_AUTH_SECRET = 'test-secret';

  try {
    const response = await handler(
      signedEvent({
        from: 'reports@example.com',
        to: ['ops@example.com'],
        subject: 'Dashboard Email Report',
        text: 'Attached',
        attachments: [{ name: 'Dashboard.pdf' }],
      })
    );

    assert.equal(response.statusCode, 400);
    assert.equal(
      JSON.parse(response.body).error,
      'each attachment requires presignedUrl and name'
    );
  } finally {
    if (originalSecret === undefined) {
      delete process.env.EMAIL_EXTERNAL_AUTH_SECRET;
    } else {
      process.env.EMAIL_EXTERNAL_AUTH_SECRET = originalSecret;
    }
  }
});
