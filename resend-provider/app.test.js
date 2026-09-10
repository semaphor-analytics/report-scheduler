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
const { createExternalProvider } = require('../email-sender/providers/external-provider');

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

test('sender admission bounds survive the signed transport and bound decoded attachment reads', async () => {
  const originalSecret = process.env.EMAIL_EXTERNAL_AUTH_SECRET;
  const originalKey = process.env.RESEND_API_KEY;
  const originalFetch = global.fetch;
  process.env.EMAIL_EXTERNAL_AUTH_SECRET = 'test-secret';
  process.env.RESEND_API_KEY = 'resend-test-key';
  sentEmails.length = 0;
  let overflow = false, cancelled = false, reads = 0;
  const csv = Buffer.from('Value\n0.000009\n');
  global.fetch = async (url, init) => {
    if (url === 'https://provider.test/send') {
      const response = await handler({ headers: init.headers, body: init.body });
      return new Response(response.body, { status: response.statusCode });
    }
    if (!overflow) return new Response(csv);
    return new Response(new ReadableStream({
      pull(controller) { reads++; controller.enqueue(new Uint8Array(csv.length)); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 }), { headers: { 'content-length': '1', 'content-encoding': 'gzip' } });
  };
  try {
    const provider = createExternalProvider({ webhookUrl: 'https://provider.test/send', authSecret: 'test-secret' });
    const message = { from: 'reports@example.com', to: ['ops@example.com'], subject: 'Matrix', textBody: 'Attached',
      attachments: [{ name: 'Matrix.csv', contentType: 'text/csv', s3Bucket: 'bucket', s3Key: 'exports/final.csv.gz',
        presignedUrl: 'https://artifact.test/csv', maxBytes: csv.length }] };
    assert.equal((await provider.send(message)).success, true);
    assert.deepEqual(sentEmails[0].message.attachments[0].content, csv);
    overflow = true;
    const result = await provider.send(message);
    assert.equal(result.success, false);
    assert.match(result.error, /admitted byte limit/);
    assert.equal(cancelled, true);
    assert.equal(reads, 2);
    assert.equal(sentEmails.length, 1);
    delete message.attachments[0].maxBytes;
    assert.equal((await provider.send(message)).success, false);
    assert.equal(reads, 2);
  } finally {
    global.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.EMAIL_EXTERNAL_AUTH_SECRET;
    else process.env.EMAIL_EXTERNAL_AUTH_SECRET = originalSecret;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  }
});

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
