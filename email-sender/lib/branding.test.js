const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ReportEmailBrandingPayloadError,
  parseReportEmailBrandingPayload,
  parseSendConsolidatedAction,
} = require('./branding');

const validBranding = {
  version: 1,
  fromName: 'Respark Reports',
  replyTo: 'reports@respark.com',
  bcc: 'archive@respark.com',
  logoUrl: 'https://cdn.respark.com/logo.png',
  accentColor: '#1a6ef4',
  intro: 'Your report is ready.',
  footer: 'Prepared for Respark.',
  callToAction: {
    url: 'https://app.respark.com/reports',
    label: 'Open app',
  },
};

test('strict branding parser accepts and normalizes the complete wire payload', () => {
  assert.deepEqual(parseReportEmailBrandingPayload(validBranding), {
    ...validBranding,
    logoUrl: 'https://cdn.respark.com/logo.png',
  });
});

for (const [name, candidate] of [
  ['unknown top-level key', { ...validBranding, unexpected: true }],
  ['unknown call-to-action key', {
    ...validBranding,
    callToAction: { ...validBranding.callToAction, unexpected: true },
  }],
  ['null optional value', { ...validBranding, replyTo: null }],
  ['non-HTTPS logo', { ...validBranding, logoUrl: 'http://cdn.test/logo.png' }],
  ['SVG logo', { ...validBranding, logoUrl: 'https://cdn.test/logo.svg' }],
  ['template call-to-action URL', {
    ...validBranding,
    callToAction: {
      url: 'https://app.test/{{report.name}}',
      label: 'Open app',
    },
  }],
  ['partial call to action', {
    ...validBranding,
    callToAction: { url: 'https://app.test/' },
  }],
  ['non-ASCII reply-to', { ...validBranding, replyTo: 'réports@test.com' }],
  ['header injection', { ...validBranding, fromName: 'Reports\r\nBcc: x@test.com' }],
]) {
  test(`strict branding parser rejects ${name}`, () => {
    assert.throws(
      () => parseReportEmailBrandingPayload(candidate),
      ReportEmailBrandingPayloadError
    );
  });
}

test('action parser enforces branding presence and forbids fields on unbranded requests', () => {
  assert.deepEqual(
    parseSendConsolidatedAction({ action: 'send_consolidated' }),
    { action: 'send_consolidated', branding: null, fromAddress: null }
  );
  assert.deepEqual(
    parseSendConsolidatedAction({
      action: 'send_consolidated_from_domain_v1',
      fromAddress: 'reports@respark.com',
    }),
    {
      action: 'send_consolidated_from_domain_v1',
      branding: null,
      fromAddress: 'reports@respark.com',
    }
  );
  assert.equal(
    parseSendConsolidatedAction({
      action: 'send_consolidated_branded_v1',
      branding: validBranding,
    }).branding.version,
    1
  );

  assert.throws(
    () =>
      parseSendConsolidatedAction({
        action: 'send_consolidated',
        branding: null,
      }),
    /does not accept branding/
  );
  assert.throws(
    () =>
      parseSendConsolidatedAction({
        action: 'send_consolidated_from_domain_v1',
      }),
    /requires fromAddress/
  );
  assert.throws(
    () =>
      parseSendConsolidatedAction({
        action: 'send_consolidated_from_domain_v1',
        branding: validBranding,
        fromAddress: 'reports@respark.com',
      }),
    /does not accept branding/
  );
  assert.throws(
    () =>
      parseSendConsolidatedAction({
        action: 'send_consolidated_branded_v1',
      }),
    /requires branding/
  );
  assert.throws(
    () =>
      parseSendConsolidatedAction({
        action: 'send_consolidated_branded_v1',
        branding: validBranding,
        fromAddress: 'reports@respark.com',
      }),
    /does not accept fromAddress/
  );

  assert.deepEqual(
    parseSendConsolidatedAction({
      action: 'send_consolidated_branded_v2',
      branding: validBranding,
      fromAddress: 'reports@respark.com',
    }),
    {
      action: 'send_consolidated_branded_v2',
      branding: validBranding,
      fromAddress: 'reports@respark.com',
    }
  );
  assert.throws(
    () =>
      parseSendConsolidatedAction({
        action: 'send_consolidated_branded_v2',
        branding: validBranding,
      }),
    /requires fromAddress/u
  );
  assert.throws(
    () =>
      parseSendConsolidatedAction({
        action: 'send_consolidated_branded_v2',
        branding: validBranding,
        fromAddress: 'reports@Respark.com',
      }),
    /fromAddress is invalid/u
  );
  assert.throws(
    () =>
      parseSendConsolidatedAction({
        action: 'send_consolidated_branded_v2',
        branding: validBranding,
        fromAddress: 'reports\u0001@respark.com',
      }),
    /fromAddress is invalid/u
  );
});
