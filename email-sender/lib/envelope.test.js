const test = require('node:test');
const assert = require('node:assert/strict');

const {
  encodeRfc2047Header,
  resolveEnvelope,
  stripHeaderLineBreaks,
} = require('./envelope');

test('unbranded ASCII envelope preserves existing header values', () => {
  assert.deepEqual(
    resolveEnvelope({
      configuredSender: 'Acme Analytics <reports@acme.com>',
      recipient: 'user@example.com',
      subject: 'Weekly report',
    }),
    {
      brandingVersion: null,
      from: 'Acme Analytics <reports@acme.com>',
      fromName: null,
      fromAddress: 'reports@acme.com',
      to: ['user@example.com'],
      replyTo: null,
      bcc: null,
      subject: 'Weekly report',
    }
  );
});

test('branded envelope resolves display name, reply-to, and hidden BCC', () => {
  assert.deepEqual(
    resolveEnvelope({
      configuredSender: 'Semaphor <noreply@semaphor.cloud>',
      recipient: 'user@example.com',
      subject: 'Revenue report',
      branding: {
        version: 1,
        fromName: 'Respark Reports',
        replyTo: 'reply@respark.com',
        bcc: 'archive@respark.com',
      },
    }),
    {
      brandingVersion: 1,
      from: 'Respark Reports <noreply@semaphor.cloud>',
      fromName: 'Respark Reports',
      fromAddress: 'noreply@semaphor.cloud',
      to: ['user@example.com'],
      replyTo: 'reply@respark.com',
      bcc: 'archive@respark.com',
      subject: 'Revenue report',
    }
  );
});

test('branded v2 envelope uses the supplied organization address', () => {
  const envelope = resolveEnvelope({
    configuredSender: 'Semaphor <noreply@semaphor.cloud>',
    fromAddress: 'reports@respark.com',
    recipient: 'user@example.com',
    subject: 'Revenue report',
    branding: {
      version: 1,
      fromName: 'Respark Reports',
    },
  });

  assert.equal(envelope.from, 'Respark Reports <reports@respark.com>');
  assert.equal(envelope.fromAddress, 'reports@respark.com');
  assert.equal(envelope.brandingVersion, 1);
});

test('unbranded envelope uses the supplied organization address', () => {
  const envelope = resolveEnvelope({
    configuredSender: 'Semaphor <noreply@semaphor.cloud>',
    fromAddress: 'reports@respark.com',
    recipient: 'user@example.com',
    subject: 'Revenue report',
  });

  assert.equal(envelope.from, 'Semaphor <reports@respark.com>');
  assert.equal(envelope.fromAddress, 'reports@respark.com');
  assert.equal(envelope.brandingVersion, null);
});

test('BCC is suppressed when it matches the primary recipient case-insensitively', () => {
  const envelope = resolveEnvelope({
    configuredSender: 'noreply@semaphor.cloud',
    recipient: 'Archive@respark.com',
    subject: 'Revenue report',
    branding: {
      version: 1,
      fromName: 'Respark Reports',
      bcc: 'archive@respark.com',
    },
  });

  assert.equal(envelope.bcc, null);
});

test('non-ASCII display names are encoded while provider subjects stay Unicode', () => {
  const envelope = resolveEnvelope({
    configuredSender: 'noreply@semaphor.cloud',
    recipient: 'user@example.com',
    subject: 'Résumé hebdomadaire',
    branding: {
      version: 1,
      fromName: 'Équipe Respark',
    },
  });

  assert.match(envelope.from, /^=\?UTF-8\?B\?.+\?= <noreply@semaphor\.cloud>$/u);
  assert.equal(envelope.subject, 'Résumé hebdomadaire');
  assert.equal(
    encodeRfc2047Header('Weekly report'),
    'Weekly report'
  );
});

test('unbranded non-ASCII configured display names also use RFC 2047 encoding', () => {
  const envelope = resolveEnvelope({
    configuredSender: 'Équipe Semaphor <noreply@semaphor.cloud>',
    recipient: 'user@example.com',
    subject: 'Weekly report',
  });

  assert.match(envelope.from, /^=\?UTF-8\?B\?.+\?= <noreply@semaphor\.cloud>$/u);
});

test('ASCII display names with mailbox punctuation are safely quoted', () => {
  const envelope = resolveEnvelope({
    configuredSender: 'noreply@semaphor.cloud',
    recipient: 'user@example.com',
    subject: 'Weekly report',
    branding: {
      version: 1,
      fromName: 'Respark, Inc.',
    },
  });

  assert.equal(envelope.from, '"Respark, Inc." <noreply@semaphor.cloud>');
});

test('line breaks are removed from header values', () => {
  assert.equal(stripHeaderLineBreaks('Weekly\r\nBcc: x@test.com'), 'WeeklyBcc: x@test.com');
  const envelope = resolveEnvelope({
    configuredSender: 'Reports\r\n <reports@example.com>',
    recipient: 'user@example.com',
    subject: 'Weekly\r\n report',
  });
  assert.equal(envelope.from, 'Reports <reports@example.com>');
  assert.equal(envelope.subject, 'Weekly report');
});

test('existing unbranded local-domain recipients remain accepted', () => {
  const envelope = resolveEnvelope({
    configuredSender: 'reports@example.com',
    recipient: 'ops@localhost',
    subject: 'Weekly report',
  });

  assert.deepEqual(envelope.to, ['ops@localhost']);
});
