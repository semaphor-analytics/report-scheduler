const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSendConsolidated,
  handler,
  prepareEmailDelivery,
} = require('./app');

function buildTestConfig(mode = 'SES') {
  return {
    emailProviderMode: mode,
    sesRegion: 'us-east-1',
    emailExternalWebhookUrl: 'https://example.com/provider',
    emailExternalAuthSecret: 'secret',
    emailMaxRawSizeBytes: 9 * 1024 * 1024,
    attachmentLinkExpirySeconds: 900,
    sesSenderEmail: 'Acme Analytics <reports@acme.com>',
  };
}

function buildPreparedDelivery() {
  return {
    attachmentsForProvider: [{ name: 'Report.pdf', fileBuffer: Buffer.from('pdf') }],
    totalAttachmentBytes: 3,
    usedLinkFallback: false,
    estimatedSesRawSizeBytes: 1024,
    downloadLinkCount: 0,
    textBody: 'Hello',
    htmlBody: '<p>Hello</p>',
    metadata: {
      scheduleId: null,
      leaseOwner: null,
      formats: ['pdf'],
      usedLinkFallback: false,
      totalAttachmentBytes: 3,
      estimatedSesRawSizeBytes: 1024,
    },
  };
}

function createSubjectUnderTest({
  mode = 'SES',
  recipients = ['a@example.com', 'b@example.com'],
  providerSend,
  prepareEmailDelivery,
  normalizeArtifacts,
  sendRetryDelaysMs,
  sleep,
} = {}) {
  return createSendConsolidated({
    getEmailSenderConfig: () => buildTestConfig(mode),
    buildProvider: () => ({
      name: mode,
      send: providerSend,
    }),
    normalizeArtifacts: normalizeArtifacts || (() => [{ format: 'pdf' }]),
    buildDirectEmailContext: () => ({
      recipientEmails: recipients,
      emailSubject: 'Weekly KPI Report',
      emailMessage: 'Attached',
      dashboardLink: 'https://app.semaphor.test/dashboard/123',
      companyName: 'Acme Analytics',
      supportEmail: 'support@acme.com',
      senderEmail: 'Acme Analytics <reports@acme.com>',
    }),
    prepareEmailDelivery,
    sendRetryDelaysMs,
    sleep,
  });
}

test('SES mode sends one message per recipient and prepares attachments once', async () => {
  let prepareCalls = 0;
  const sentMessages = [];

  const sendConsolidated = createSubjectUnderTest({
    mode: 'SES',
    recipients: ['a@example.com', 'b@example.com', 'c@example.com'],
    providerSend: async (message) => {
      sentMessages.push(message);
      return { success: true, providerMessageId: `ses-${sentMessages.length}` };
    },
    prepareEmailDelivery: async () => {
      prepareCalls += 1;
      return buildPreparedDelivery();
    },
  });

  const result = await sendConsolidated({ attachments: [{ id: 'artifact' }] });

  assert.equal(prepareCalls, 1);
  assert.equal(sentMessages.length, 3);
  assert.deepEqual(
    sentMessages.map((message) => message.to),
    [['a@example.com'], ['b@example.com'], ['c@example.com']]
  );
  assert.equal(result.success, true);
  assert.equal(result.allSucceeded, true);
  assert.equal(result.recipientCount, 3);
  assert.equal(result.successCount, 3);
  assert.equal(result.failureCount, 0);
  assert.deepEqual(result.failedRecipients, []);
  assert.deepEqual(result.providerMessageIds, ['ses-1', 'ses-2', 'ses-3']);
});

test('Function URL handler accepts signed send_consolidated requests', async () => {
  const originalSecret = process.env.LAMBDA_API_KEY;
  const originalMode = process.env.EMAIL_PROVIDER_MODE;
  const originalSender = process.env.SES_SENDER_EMAIL;
  const originalBucket = process.env.S3_BUCKET_NAME;
  const originalWebhookUrl = process.env.EMAIL_EXTERNAL_WEBHOOK_URL;
  const originalWebhookSecret = process.env.EMAIL_EXTERNAL_AUTH_SECRET;
  const originalFetch = global.fetch;

  process.env.LAMBDA_API_KEY = 'http-secret';
  process.env.EMAIL_PROVIDER_MODE = 'EXTERNAL';
  process.env.SES_SENDER_EMAIL = 'Acme Analytics <reports@acme.com>';
  process.env.S3_BUCKET_NAME = 'reports-bucket';
  process.env.EMAIL_EXTERNAL_WEBHOOK_URL = 'https://mail.example.com/send';
  process.env.EMAIL_EXTERNAL_AUTH_SECRET = 'external-secret';
  global.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () =>
      JSON.stringify({
        success: true,
        providerMessageId: 'external-1',
      }),
  });

  try {
    const response = await handler({
      version: '2.0',
      requestContext: {
        http: {
          method: 'POST',
        },
      },
      headers: {
        'x-api-key': 'http-secret',
      },
      body: JSON.stringify({
        action: 'send_consolidated',
        recipients: ['a@example.com'],
        subject: 'Dashboard Email Report',
        message: 'Attached',
        attachments: [
          {
            attachmentName: 'Dashboard',
            format: 'pdf',
            s3Bucket: 'reports-bucket',
            s3Key: 'emails/dashboard.pdf',
            sizeBytes: 3,
          },
        ],
      }),
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.allSucceeded, true);
    assert.equal(body.recipientCount, 1);
    assert.equal(body.providerMessageId, 'external-1');
  } finally {
    global.fetch = originalFetch;
    if (originalSecret === undefined) {
      delete process.env.LAMBDA_API_KEY;
    } else {
      process.env.LAMBDA_API_KEY = originalSecret;
    }
    if (originalMode === undefined) {
      delete process.env.EMAIL_PROVIDER_MODE;
    } else {
      process.env.EMAIL_PROVIDER_MODE = originalMode;
    }
    if (originalSender === undefined) {
      delete process.env.SES_SENDER_EMAIL;
    } else {
      process.env.SES_SENDER_EMAIL = originalSender;
    }
    if (originalBucket === undefined) {
      delete process.env.S3_BUCKET_NAME;
    } else {
      process.env.S3_BUCKET_NAME = originalBucket;
    }
    if (originalWebhookUrl === undefined) {
      delete process.env.EMAIL_EXTERNAL_WEBHOOK_URL;
    } else {
      process.env.EMAIL_EXTERNAL_WEBHOOK_URL = originalWebhookUrl;
    }
    if (originalWebhookSecret === undefined) {
      delete process.env.EMAIL_EXTERNAL_AUTH_SECRET;
    } else {
      process.env.EMAIL_EXTERNAL_AUTH_SECRET = originalWebhookSecret;
    }
  }
});

test('Function URL handler returns 200 with structured partial send failures', async () => {
  const originalSecret = process.env.LAMBDA_API_KEY;
  const originalMode = process.env.EMAIL_PROVIDER_MODE;
  const originalSender = process.env.SES_SENDER_EMAIL;
  const originalBucket = process.env.S3_BUCKET_NAME;
  const originalWebhookUrl = process.env.EMAIL_EXTERNAL_WEBHOOK_URL;
  const originalWebhookSecret = process.env.EMAIL_EXTERNAL_AUTH_SECRET;
  const originalFetch = global.fetch;
  let sendCount = 0;

  process.env.LAMBDA_API_KEY = 'http-secret';
  process.env.EMAIL_PROVIDER_MODE = 'EXTERNAL';
  process.env.SES_SENDER_EMAIL = 'Acme Analytics <reports@acme.com>';
  process.env.S3_BUCKET_NAME = 'reports-bucket';
  process.env.EMAIL_EXTERNAL_WEBHOOK_URL = 'https://mail.example.com/send';
  process.env.EMAIL_EXTERNAL_AUTH_SECRET = 'external-secret';
  global.fetch = async () => {
    sendCount += 1;
    if (sendCount === 1) {
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () =>
          JSON.stringify({
            success: true,
            providerMessageId: 'external-1',
          }),
      };
    }

    return {
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => JSON.stringify({ error: 'Suppressed recipient' }),
    };
  };

  try {
    const response = await handler({
      version: '2.0',
      requestContext: {
        http: {
          method: 'POST',
        },
      },
      headers: {
        'x-api-key': 'http-secret',
      },
      body: JSON.stringify({
        action: 'send_consolidated',
        recipients: ['sent@example.com', 'failed@example.com'],
        subject: 'Dashboard Email Report',
        message: 'Attached',
        attachments: [],
      }),
    });

    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.allSucceeded, false);
    assert.equal(body.successCount, 1);
    assert.equal(body.failureCount, 1);
    assert.deepEqual(body.providerMessageIds, ['external-1']);
    assert.deepEqual(body.failedRecipients, ['failed@example.com']);
  } finally {
    global.fetch = originalFetch;
    if (originalSecret === undefined) {
      delete process.env.LAMBDA_API_KEY;
    } else {
      process.env.LAMBDA_API_KEY = originalSecret;
    }
    if (originalMode === undefined) {
      delete process.env.EMAIL_PROVIDER_MODE;
    } else {
      process.env.EMAIL_PROVIDER_MODE = originalMode;
    }
    if (originalSender === undefined) {
      delete process.env.SES_SENDER_EMAIL;
    } else {
      process.env.SES_SENDER_EMAIL = originalSender;
    }
    if (originalBucket === undefined) {
      delete process.env.S3_BUCKET_NAME;
    } else {
      process.env.S3_BUCKET_NAME = originalBucket;
    }
    if (originalWebhookUrl === undefined) {
      delete process.env.EMAIL_EXTERNAL_WEBHOOK_URL;
    } else {
      process.env.EMAIL_EXTERNAL_WEBHOOK_URL = originalWebhookUrl;
    }
    if (originalWebhookSecret === undefined) {
      delete process.env.EMAIL_EXTERNAL_AUTH_SECRET;
    } else {
      process.env.EMAIL_EXTERNAL_AUTH_SECRET = originalWebhookSecret;
    }
  }
});

test('Function URL handler rejects unsigned requests', async () => {
  const originalSecret = process.env.LAMBDA_API_KEY;
  process.env.LAMBDA_API_KEY = 'http-secret';

  try {
    const response = await handler({
      version: '2.0',
      requestContext: {
        http: {
          method: 'POST',
        },
      },
      headers: {},
      body: JSON.stringify({
        action: 'send_consolidated',
      }),
    });

    assert.equal(response.statusCode, 401);
  } finally {
    if (originalSecret === undefined) {
      delete process.env.LAMBDA_API_KEY;
    } else {
      process.env.LAMBDA_API_KEY = originalSecret;
    }
  }
});

test('EXTERNAL mode sends one message per recipient', async () => {
  const sentMessages = [];

  const sendConsolidated = createSubjectUnderTest({
    mode: 'EXTERNAL',
    recipients: ['a@example.com', 'b@example.com'],
    providerSend: async (message) => {
      sentMessages.push(message);
      return { success: true, providerMessageId: `ext-${sentMessages.length}` };
    },
    prepareEmailDelivery: async () => buildPreparedDelivery(),
  });

  const result = await sendConsolidated({ attachments: [{ id: 'artifact' }] });

  assert.equal(sentMessages.length, 2);
  assert.deepEqual(
    sentMessages.map((message) => message.to),
    [['a@example.com'], ['b@example.com']]
  );
  assert.equal(result.provider, 'EXTERNAL');
  assert.equal(result.successCount, 2);
  assert.equal(result.failureCount, 0);
});

test('body-only direct emails can be sent without attachments', async () => {
  const sentMessages = [];

  const sendConsolidated = createSubjectUnderTest({
    mode: 'SES',
    recipients: ['a@example.com'],
    normalizeArtifacts: () => [],
    providerSend: async (message) => {
      sentMessages.push(message);
      return { success: true, providerMessageId: 'ses-body-only' };
    },
    prepareEmailDelivery: async ({ artifacts }) => {
      assert.deepEqual(artifacts, []);
      return {
        ...buildPreparedDelivery(),
        attachmentsForProvider: [],
        totalAttachmentBytes: 0,
        metadata: {
          ...buildPreparedDelivery().metadata,
          formats: [],
          totalAttachmentBytes: 0,
        },
      };
    },
  });

  const result = await sendConsolidated({ attachments: [] });

  assert.equal(sentMessages.length, 1);
  assert.deepEqual(sentMessages[0].attachments, []);
  assert.equal(result.success, true);
  assert.equal(result.attachmentCount, 0);
  assert.equal(result.sentAttachmentCount, 0);
});

test('continues sending after recipient failures and aggregates result', async () => {
  const sentMessages = [];

  const sendConsolidated = createSubjectUnderTest({
    mode: 'SES',
    recipients: ['a@example.com', 'b@example.com', 'c@example.com'],
    providerSend: async (message) => {
      sentMessages.push(message);
      if (message.to[0] === 'b@example.com') {
        return { success: false, error: 'Mailbox unavailable' };
      }
      return { success: true, providerMessageId: `ses-${sentMessages.length}` };
    },
    prepareEmailDelivery: async () => buildPreparedDelivery(),
  });

  const result = await sendConsolidated({ attachments: [{ id: 'artifact' }] });

  assert.equal(sentMessages.length, 3);
  assert.equal(result.success, false);
  assert.equal(result.allSucceeded, false);
  assert.equal(result.successCount, 2);
  assert.equal(result.failureCount, 1);
  assert.deepEqual(result.failedRecipients, ['b@example.com']);
  assert.match(
    result.statusMessage,
    /Failed to send to: b@example\.com \(Mailbox unavailable\)/
  );
});

test('single-recipient schedules still send once', async () => {
  const sentMessages = [];

  const sendConsolidated = createSubjectUnderTest({
    mode: 'SES',
    recipients: ['solo@example.com'],
    providerSend: async (message) => {
      sentMessages.push(message);
      return { success: true, providerMessageId: 'ses-1' };
    },
    prepareEmailDelivery: async () => buildPreparedDelivery(),
  });

  const result = await sendConsolidated({ attachments: [{ id: 'artifact' }] });

  assert.equal(sentMessages.length, 1);
  assert.deepEqual(sentMessages[0].to, ['solo@example.com']);
  assert.equal(result.recipientCount, 1);
  assert.equal(result.providerMessageId, 'ses-1');
});

test('retries transient send failures before succeeding', async () => {
  const attemptCounts = new Map();
  const slept = [];

  const sendConsolidated = createSubjectUnderTest({
    mode: 'SES',
    recipients: ['a@example.com', 'b@example.com'],
    providerSend: async (message) => {
      const recipient = message.to[0];
      const attempts = (attemptCounts.get(recipient) || 0) + 1;
      attemptCounts.set(recipient, attempts);

      if (recipient === 'a@example.com' && attempts === 1) {
        return {
          success: false,
          error: 'Throttling - Maximum sending rate exceeded',
        };
      }

      return { success: true, providerMessageId: `${recipient}-${attempts}` };
    },
    prepareEmailDelivery: async () => buildPreparedDelivery(),
    sendRetryDelaysMs: [0, 0],
    sleep: async (ms) => {
      slept.push(ms);
    },
  });

  const result = await sendConsolidated({ attachments: [{ id: 'artifact' }] });

  assert.equal(result.success, true);
  assert.equal(result.recipientCount, 2);
  assert.equal(attemptCounts.get('a@example.com'), 2);
  assert.equal(attemptCounts.get('b@example.com'), 1);
  assert.deepEqual(slept, [0]);
});

test('does not retry non-transient send failures', async () => {
  const attemptCounts = new Map();

  const sendConsolidated = createSubjectUnderTest({
    mode: 'SES',
    recipients: ['a@example.com'],
    providerSend: async (message) => {
      const recipient = message.to[0];
      const attempts = (attemptCounts.get(recipient) || 0) + 1;
      attemptCounts.set(recipient, attempts);

      return {
        success: false,
        error: 'Message rejected: Email address is not verified',
      };
    },
    prepareEmailDelivery: async () => buildPreparedDelivery(),
    sendRetryDelaysMs: [0, 0],
    sleep: async () => {
      throw new Error('sleep should not be called for non-retryable failures');
    },
  });

  const result = await sendConsolidated({ attachments: [{ id: 'artifact' }] });

  assert.equal(result.success, false);
  assert.equal(result.failureCount, 1);
  assert.equal(attemptCounts.get('a@example.com'), 1);
});

test('prepareEmailDelivery keeps external provider URLs on the short expiry', async () => {
  const prepared = await prepareEmailDelivery({
    artifacts: [
      {
        name: 'Report.pdf',
        rawName: 'Report',
        format: 'pdf',
        contentType: 'application/pdf',
        s3Bucket: 'reports-bucket',
        s3Key: 'emails/report.pdf',
      },
    ],
    emailContext: {
      recipientEmails: ['a@example.com'],
      emailSubject: 'Report',
      emailMessage: 'Attached',
      dashboardLink: 'https://app.semaphor.test/dashboard/123',
      companyName: 'Acme Analytics',
      supportEmail: 'support@acme.com',
      senderEmail: 'Acme Analytics <reports@acme.com>',
    },
    provider: { name: 'EXTERNAL' },
    scheduleId: 'sched_123',
    leaseOwner: 'lease_123',
    config: {
      attachmentLinkExpirySeconds: 24 * 60 * 60,
    },
  });

  assert.equal(prepared.attachmentsForProvider.length, 1);
  assert.equal(
    prepared.attachmentsForProvider[0].expiresInSeconds,
    15 * 60
  );
  assert.equal(
    typeof prepared.attachmentsForProvider[0].presignedUrl,
    'string'
  );
  assert.match(
    prepared.attachmentsForProvider[0].presignedUrl,
    /emails%2Freport\.pdf|emails\/report\.pdf/
  );
});
