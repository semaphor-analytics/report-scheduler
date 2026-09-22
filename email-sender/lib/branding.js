const REPORT_EMAIL_BRANDING_PAYLOAD_VERSION = 1;

const REPORT_EMAIL_BRANDED_ACTION = 'send_consolidated_branded_v1';
const REPORT_EMAIL_BRANDED_V2_ACTION = 'send_consolidated_branded_v2';
const REPORT_EMAIL_UNBRANDED_ACTION = 'send_consolidated';
const REPORT_EMAIL_UNBRANDED_FROM_DOMAIN_ACTION =
  'send_consolidated_from_domain_v1';

const REPORT_EMAIL_BRANDING_KEYS = [
  'version',
  'fromName',
  'replyTo',
  'bcc',
  'logoUrl',
  'accentColor',
  'intro',
  'footer',
  'callToAction',
];

class ReportEmailBrandingPayloadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReportEmailBrandingPayloadError';
  }
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertStrictKeys(value, allowedKeys, field) {
  const unexpectedKey = Object.keys(value).find(
    (key) => !allowedKeys.includes(key)
  );
  if (unexpectedKey) {
    throw new ReportEmailBrandingPayloadError(
      `${field} contains unsupported key "${unexpectedKey}"`
    );
  }
}

function parseDisplayName(value, field = 'branding.fromName') {
  if (typeof value !== 'string') {
    throw new ReportEmailBrandingPayloadError(`${field} must be a string`);
  }

  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 80 ||
    /[\u0000-\u001f\u007f-\u009f<>"]/u.test(normalized)
  ) {
    throw new ReportEmailBrandingPayloadError(`${field} is invalid`);
  }

  return normalized;
}

function parseEmailAddress(value, field) {
  if (typeof value !== 'string') {
    throw new ReportEmailBrandingPayloadError(`${field} must be a string`);
  }
  if (
    value !== value.trim() ||
    value.length < 3 ||
    value.length > 254 ||
    /[\r\n]/u.test(value) ||
    !/^[\x00-\x7f]+$/u.test(value) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)
  ) {
    throw new ReportEmailBrandingPayloadError(`${field} is invalid`);
  }

  return value;
}

function isSevenBitText(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code > 0x7e) {
      return false;
    }
  }
  return true;
}

function isValidSendingDomain(domain) {
  if (
    typeof domain !== 'string' ||
    domain.length < 3 ||
    domain.length > 253 ||
    domain !== domain.toLowerCase() ||
    !/^[\x00-\x7f]+$/u.test(domain)
  ) {
    return false;
  }

  const labels = domain.split('.');
  return (
    labels.length >= 2 &&
    labels.every(
      (label) =>
        label.length >= 1 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label)
    )
  );
}

function parseSendingAddress(value, field = 'fromAddress') {
  const fromAddress = parseEmailAddress(value, field);
  const atIndex = fromAddress.indexOf('@');
  const mailbox = fromAddress.slice(0, atIndex);
  const domain = fromAddress.slice(atIndex + 1);

  if (
    atIndex <= 0 ||
    atIndex !== fromAddress.lastIndexOf('@') ||
    mailbox.length > 64 ||
    !isSevenBitText(mailbox) ||
    !isValidSendingDomain(domain)
  ) {
    throw new ReportEmailBrandingPayloadError(`${field} is invalid`);
  }

  return { fromAddress, mailbox, domain };
}

function parseHttpsUrl(value, field, { requireEmailImage = false } = {}) {
  if (typeof value !== 'string') {
    throw new ReportEmailBrandingPayloadError(`${field} is invalid`);
  }

  const normalizedInput = value.trim();
  if (normalizedInput.length > 2048) {
    throw new ReportEmailBrandingPayloadError(`${field} is invalid`);
  }

  let parsed;
  try {
    parsed = new URL(normalizedInput);
  } catch {
    throw new ReportEmailBrandingPayloadError(`${field} is invalid`);
  }

  if (
    parsed.protocol !== 'https:' ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    normalizedInput.includes('{{') ||
    normalizedInput.includes('}}') ||
    (requireEmailImage && !/\.(?:png|jpe?g|gif)$/iu.test(parsed.pathname))
  ) {
    throw new ReportEmailBrandingPayloadError(`${field} is invalid`);
  }

  return parsed.toString();
}

function parseOptionalString(value, field, maxLength) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maxLength
  ) {
    throw new ReportEmailBrandingPayloadError(`${field} is invalid`);
  }
  return value;
}

function parseCallToAction(value) {
  if (!isPlainObject(value)) {
    throw new ReportEmailBrandingPayloadError(
      'branding.callToAction must be an object'
    );
  }
  assertStrictKeys(value, ['url', 'label'], 'branding.callToAction');
  if (!hasOwn(value, 'url') || !hasOwn(value, 'label')) {
    throw new ReportEmailBrandingPayloadError(
      'branding.callToAction requires url and label'
    );
  }

  if (typeof value.label !== 'string') {
    throw new ReportEmailBrandingPayloadError(
      'branding.callToAction.label is invalid'
    );
  }
  const label = value.label.trim();
  if (
    label.length < 1 ||
    label.length > 40 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(label)
  ) {
    throw new ReportEmailBrandingPayloadError(
      'branding.callToAction.label is invalid'
    );
  }

  return {
    url: parseHttpsUrl(value.url, 'branding.callToAction.url'),
    label,
  };
}

function parseReportEmailBrandingPayload(value) {
  if (!isPlainObject(value)) {
    throw new ReportEmailBrandingPayloadError('branding must be an object');
  }
  assertStrictKeys(value, REPORT_EMAIL_BRANDING_KEYS, 'branding');
  if (value.version !== REPORT_EMAIL_BRANDING_PAYLOAD_VERSION) {
    throw new ReportEmailBrandingPayloadError(
      `branding.version must be ${REPORT_EMAIL_BRANDING_PAYLOAD_VERSION}`
    );
  }
  if (!/^#[0-9a-fA-F]{6}$/u.test(String(value.accentColor || ''))) {
    throw new ReportEmailBrandingPayloadError(
      'branding.accentColor is invalid'
    );
  }

  const parsed = {
    version: REPORT_EMAIL_BRANDING_PAYLOAD_VERSION,
    fromName: parseDisplayName(value.fromName),
    accentColor: value.accentColor,
  };

  if (hasOwn(value, 'replyTo')) {
    parsed.replyTo = parseEmailAddress(value.replyTo, 'branding.replyTo');
  }
  if (hasOwn(value, 'bcc')) {
    parsed.bcc = parseEmailAddress(value.bcc, 'branding.bcc');
  }
  if (hasOwn(value, 'logoUrl')) {
    parsed.logoUrl = parseHttpsUrl(value.logoUrl, 'branding.logoUrl', {
      requireEmailImage: true,
    });
  }
  if (hasOwn(value, 'intro')) {
    parsed.intro = parseOptionalString(value.intro, 'branding.intro', 4000);
  }
  if (hasOwn(value, 'footer')) {
    parsed.footer = parseOptionalString(value.footer, 'branding.footer', 2000);
  }
  if (hasOwn(value, 'callToAction')) {
    parsed.callToAction = parseCallToAction(value.callToAction);
  }

  return parsed;
}

function parseSendConsolidatedAction(payload) {
  if (!isPlainObject(payload)) {
    throw new ReportEmailBrandingPayloadError('Payload must be an object');
  }

  const hasBranding = hasOwn(payload, 'branding');
  const hasFromAddress = hasOwn(payload, 'fromAddress');

  if (payload.action === REPORT_EMAIL_UNBRANDED_ACTION) {
    if (hasBranding || hasFromAddress) {
      throw new ReportEmailBrandingPayloadError(
        'send_consolidated does not accept branding or fromAddress'
      );
    }
    return {
      action: REPORT_EMAIL_UNBRANDED_ACTION,
      branding: null,
      fromAddress: null,
    };
  }

  if (payload.action === REPORT_EMAIL_UNBRANDED_FROM_DOMAIN_ACTION) {
    if (hasBranding) {
      throw new ReportEmailBrandingPayloadError(
        'send_consolidated_from_domain_v1 does not accept branding'
      );
    }
    if (!hasFromAddress) {
      throw new ReportEmailBrandingPayloadError(
        'send_consolidated_from_domain_v1 requires fromAddress'
      );
    }
    return {
      action: REPORT_EMAIL_UNBRANDED_FROM_DOMAIN_ACTION,
      branding: null,
      fromAddress: parseSendingAddress(payload.fromAddress).fromAddress,
    };
  }

  if (payload.action === REPORT_EMAIL_BRANDED_ACTION) {
    if (!hasBranding) {
      throw new ReportEmailBrandingPayloadError(
        'send_consolidated_branded_v1 requires branding'
      );
    }
    if (hasFromAddress) {
      throw new ReportEmailBrandingPayloadError(
        'send_consolidated_branded_v1 does not accept fromAddress'
      );
    }
    return {
      action: REPORT_EMAIL_BRANDED_ACTION,
      branding: parseReportEmailBrandingPayload(payload.branding),
      fromAddress: null,
    };
  }

  if (payload.action === REPORT_EMAIL_BRANDED_V2_ACTION) {
    if (!hasBranding) {
      throw new ReportEmailBrandingPayloadError(
        'send_consolidated_branded_v2 requires branding'
      );
    }
    if (!hasFromAddress) {
      throw new ReportEmailBrandingPayloadError(
        'send_consolidated_branded_v2 requires fromAddress'
      );
    }
    return {
      action: REPORT_EMAIL_BRANDED_V2_ACTION,
      branding: parseReportEmailBrandingPayload(payload.branding),
      fromAddress: parseSendingAddress(payload.fromAddress).fromAddress,
    };
  }

  throw new ReportEmailBrandingPayloadError(
    'Only send_consolidated, send_consolidated_from_domain_v1, send_consolidated_branded_v1, and send_consolidated_branded_v2 are supported'
  );
}

module.exports = {
  REPORT_EMAIL_BRANDED_ACTION,
  REPORT_EMAIL_BRANDED_V2_ACTION,
  REPORT_EMAIL_UNBRANDED_ACTION,
  REPORT_EMAIL_UNBRANDED_FROM_DOMAIN_ACTION,
  ReportEmailBrandingPayloadError,
  isValidSendingDomain,
  parseDisplayName,
  parseEmailAddress,
  parseReportEmailBrandingPayload,
  parseSendConsolidatedAction,
  parseSendingAddress,
};
