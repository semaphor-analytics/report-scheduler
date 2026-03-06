function parseInteger(value, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return defaultValue;
  }
  return parsed;
}

function getEmailSenderConfig() {
  const mode = String(process.env.EMAIL_PROVIDER_MODE || 'SES')
    .trim()
    .toUpperCase();

  return {
    emailProviderMode: mode === 'EXTERNAL' ? 'EXTERNAL' : 'SES',
    sesRegion: process.env.SES_REGION || 'us-east-1',
    emailExternalWebhookUrl: process.env.EMAIL_EXTERNAL_WEBHOOK_URL || '',
    emailExternalAuthSecret: process.env.EMAIL_EXTERNAL_AUTH_SECRET || '',
    emailMaxRawSizeBytes: parseInteger(
      process.env.EMAIL_MAX_RAW_SIZE_BYTES,
      9 * 1024 * 1024
    ),
    attachmentLinkExpirySeconds: parseInteger(
      process.env.EMAIL_ATTACHMENT_LINK_EXPIRY_SECONDS,
      24 * 60 * 60
    ),
    sesSenderEmail:
      process.env.SES_SENDER_EMAIL || 'Semaphor <noreply@example.com>',
  };
}

module.exports = {
  getEmailSenderConfig,
};
