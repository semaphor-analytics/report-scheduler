const crypto = require('crypto');

function createSignature(secret, timestamp, rawBody) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
}

function parseResponseBody(rawBody) {
  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}

function createExternalProvider({
  webhookUrl,
  authSecret,
  s3,
  presignedUrlExpirySeconds = 900,
}) {
  return {
    name: 'EXTERNAL',
    requiresFileBuffer: false,
    async send(message) {
      try {
        if (!webhookUrl) {
          return {
            success: false,
            error:
              'EMAIL_EXTERNAL_WEBHOOK_URL is required when EMAIL_PROVIDER_MODE=EXTERNAL',
          };
        }

        if (!authSecret) {
          return {
            success: false,
            error:
              'EMAIL_EXTERNAL_AUTH_SECRET is required when EMAIL_PROVIDER_MODE=EXTERNAL',
          };
        }

        if (!message?.attachment?.s3Bucket || !message?.attachment?.s3Key) {
          return {
            success: false,
            error:
              'Attachment metadata is missing s3Bucket/s3Key for external provider',
          };
        }

        const presignedUrl = s3.getSignedUrl('getObject', {
          Bucket: message.attachment.s3Bucket,
          Key: message.attachment.s3Key,
          Expires: presignedUrlExpirySeconds,
        });

        const payload = {
          from: message.from,
          to: message.to,
          subject: message.subject,
          text: message.textBody,
          html: message.htmlBody,
          attachment: {
            name: message.attachment.name,
            contentType: message.attachment.contentType,
            s3Bucket: message.attachment.s3Bucket,
            s3Key: message.attachment.s3Key,
            presignedUrl,
            expiresInSeconds: presignedUrlExpirySeconds,
          },
          metadata: message.metadata || {},
        };

        const rawBody = JSON.stringify(payload);
        const headers = {
          'Content-Type': 'application/json',
        };

        const timestamp = String(Date.now());
        headers['X-Semaphor-Timestamp'] = timestamp;
        headers['X-Semaphor-Signature'] = createSignature(
          authSecret,
          timestamp,
          rawBody
        );

        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers,
          body: rawBody,
        });

        const responseBodyRaw = await response.text();
        const responseBody = parseResponseBody(responseBodyRaw);

        if (!response.ok) {
          return {
            success: false,
            error: `External provider request failed: HTTP ${response.status} ${response.statusText}${responseBodyRaw ? ` - ${responseBodyRaw}` : ''}`,
          };
        }

        if (!responseBody || responseBody.success !== true) {
          return {
            success: false,
            error:
              responseBody?.error ||
              'External provider response missing success=true',
          };
        }

        return {
          success: true,
          providerMessageId: responseBody.providerMessageId || null,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

module.exports = {
  createExternalProvider,
};
