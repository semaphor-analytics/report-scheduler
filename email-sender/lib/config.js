function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function getEmailSenderConfig() {
  const mode = String(process.env.EMAIL_PROVIDER_MODE || 'SES')
    .trim()
    .toUpperCase();

  return {
    emailProviderMode: mode === 'EXTERNAL' ? 'EXTERNAL' : 'SES',
    emailEnableMultiRecipients: parseBoolean(
      process.env.EMAIL_ENABLE_MULTI_RECIPIENTS,
      false
    ),
    sesRegion: process.env.SES_REGION || 'us-east-1',
    emailExternalWebhookUrl: process.env.EMAIL_EXTERNAL_WEBHOOK_URL || '',
    emailExternalAuthSecret: process.env.EMAIL_EXTERNAL_AUTH_SECRET || '',
    sesSenderEmail:
      process.env.SES_SENDER_EMAIL || 'Semaphor <noreply@example.com>',
  };
}

module.exports = {
  getEmailSenderConfig,
};
