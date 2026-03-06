const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSendConsolidated,
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
  sendRetryDelaysMs,
  sleep,
} = {}) {
  return createSendConsolidated({
    getEmailSenderConfig: () => buildTestConfig(mode),
    buildProvider: () => ({
      name: mode,
      send: providerSend,
    }),
    normalizeArtifacts: () => [{ format: 'pdf' }],
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
  assert.equal('presignedUrl' in prepared.attachmentsForProvider[0], false);
});
