const AWS = require('aws-sdk');
const crypto = require('crypto');
const s3 = new AWS.S3();

const { getEmailSenderConfig } = require('./lib/config');
const {
  buildEmailBodies,
  getAttachmentContentType,
  getAttachmentFilename,
} = require('./lib/email-content');
const { createSesProvider } = require('./providers/ses-provider');
const { createExternalProvider } = require('./providers/external-provider');

const SES_MIME_SIZE_SAFETY_BUFFER_BYTES = 64 * 1024;
const SEND_RETRY_DELAYS_MS = [250, 1000, 3000];
const EXTERNAL_PROVIDER_URL_EXPIRY_SECONDS = 15 * 60;

function parseRecipientEmails(rawRecipients) {
  if (Array.isArray(rawRecipients)) {
    return rawRecipients
      .map((email) => String(email || '').trim())
      .filter((email) => email && email.includes('@'));
  }

  return String(rawRecipients || '')
    .split(',')
    .map((email) => email.trim())
    .filter((email) => email && email.includes('@'));
}

function buildProvider(config) {
  if (config.emailProviderMode === 'EXTERNAL') {
    return createExternalProvider({
      webhookUrl: config.emailExternalWebhookUrl,
      authSecret: config.emailExternalAuthSecret,
      s3,
      presignedUrlExpirySeconds: 900,
    });
  }

  return createSesProvider({ sesRegion: config.sesRegion });
}

function normalizeArtifacts(rawAttachments) {
  const attachments = Array.isArray(rawAttachments)
    ? rawAttachments
    : rawAttachments
      ? [rawAttachments]
      : [];

  return attachments.map((attachment, index) => {
    const format =
      String(attachment?.format || '')
        .trim()
        .toLowerCase() || 'pdf';
    const attachmentName =
      attachment?.attachmentName || attachment?.name || `Report ${index + 1}`;
    const contentType =
      attachment?.contentType || getAttachmentContentType(format);
    const s3Bucket = attachment?.s3Bucket || attachment?.bucket || '';
    const s3Key = attachment?.s3Key || attachment?.key || '';

    if (!s3Bucket || !s3Key) {
      throw new Error(
        `Attachment "${attachmentName}" is missing s3Bucket/s3Key`
      );
    }

    return {
      name: getAttachmentFilename(attachmentName, format),
      rawName: attachmentName,
      format,
      contentType,
      s3Bucket,
      s3Key,
      sizeBytes:
        typeof attachment?.sizeBytes === 'number' ? attachment.sizeBytes : null,
    };
  });
}

function buildDownloadLinks(attachments, expiresInSeconds) {
  return attachments.map((attachment) => ({
    name: attachment.rawName,
    format: attachment.format,
    url: s3.getSignedUrl('getObject', {
      Bucket: attachment.s3Bucket,
      Key: attachment.s3Key,
      Expires: expiresInSeconds,
      ResponseContentDisposition: `attachment; filename="${attachment.name}"`,
    }),
  }));
}

function buildExternalPayloadAttachments(attachments, expiresInSeconds) {
  return attachments.map((attachment) => ({
    name: attachment.name,
    contentType: attachment.contentType,
    presignedUrl: s3.getSignedUrl('getObject', {
      Bucket: attachment.s3Bucket,
      Key: attachment.s3Key,
      Expires: expiresInSeconds,
      ResponseContentDisposition: `attachment; filename="${attachment.name}"`,
    }),
    s3Bucket: attachment.s3Bucket,
    s3Key: attachment.s3Key,
    expiresInSeconds,
  }));
}

async function resolveAttachmentSizeBytes(attachment) {
  if (
    typeof attachment?.sizeBytes === 'number' &&
    Number.isFinite(attachment.sizeBytes) &&
    attachment.sizeBytes >= 0
  ) {
    return attachment.sizeBytes;
  }

  const objectHead = await s3
    .headObject({
      Bucket: attachment.s3Bucket,
      Key: attachment.s3Key,
    })
    .promise();

  const contentLength = Number(objectHead?.ContentLength);
  if (!Number.isFinite(contentLength) || contentLength < 0) {
    throw new Error(
      `Unable to resolve size for attachment "${attachment.name}" from S3 headObject`
    );
  }

  return contentLength;
}

async function resolveAttachmentsWithSize(attachments) {
  const resolved = await Promise.all(
    attachments.map(async (attachment) => ({
      ...attachment,
      resolvedSizeBytes: await resolveAttachmentSizeBytes(attachment),
    }))
  );

  return {
    attachments: resolved,
    totalAttachmentBytes: resolved.reduce(
      (total, attachment) => total + attachment.resolvedSizeBytes,
      0
    ),
  };
}

function estimateBase64EncodedSizeBytes(inputBytes) {
  if (!Number.isFinite(inputBytes) || inputBytes <= 0) {
    return 0;
  }

  const base64Chars = Math.ceil(inputBytes / 3) * 4;
  const lineBreakCount = Math.floor(Math.max(base64Chars - 1, 0) / 76);
  return base64Chars + lineBreakCount * 2;
}

function estimateSesRawMessageSizeBytes({
  from,
  to,
  subject,
  textBody,
  htmlBody,
  attachments,
}) {
  const toHeader = Array.isArray(to) ? to.join(', ') : String(to || '');

  let estimated = Buffer.byteLength(String(from || ''), 'utf8');
  estimated += Buffer.byteLength(toHeader, 'utf8');
  estimated += Buffer.byteLength(String(subject || ''), 'utf8');
  estimated += Buffer.byteLength(String(textBody || ''), 'utf8');
  estimated += Buffer.byteLength(String(htmlBody || ''), 'utf8');
  estimated += 4096; // MIME boundaries + fixed headers

  for (const attachment of attachments) {
    const fileBytes = attachment?.resolvedSizeBytes || 0;
    const encodedBytes = estimateBase64EncodedSizeBytes(fileBytes);
    const partOverhead = Buffer.byteLength(
      `Content-Type: ${attachment.contentType}; name="${attachment.name}"\r\n` +
        `Content-Disposition: attachment; filename="${attachment.name}"\r\n` +
        'Content-Transfer-Encoding: base64\r\n\r\n',
      'utf8'
    );

    estimated += encodedBytes + partOverhead + 32;
  }

  return estimated + SES_MIME_SIZE_SAFETY_BUFFER_BYTES;
}

async function attachSesBuffers(attachments) {
  const bufferedAttachments = [];

  for (const attachment of attachments) {
    const objectData = await s3
      .getObject({
        Bucket: attachment.s3Bucket,
        Key: attachment.s3Key,
      })
      .promise();
    const fileBuffer = Buffer.isBuffer(objectData.Body)
      ? objectData.Body
      : Buffer.from(objectData.Body || '');

    bufferedAttachments.push({
      ...attachment,
      fileBuffer,
    });
  }

  return {
    attachments: bufferedAttachments,
  };
}

async function buildScheduledEmailContext(scheduleId, payload, config) {
  const scheduleData = await getScheduleDetails(scheduleId);
  const recipientEmails = parseRecipientEmails(
    payload?.recipients || scheduleData.recipients || ''
  );

  if (recipientEmails.length === 0) {
    throw new Error('No valid recipient emails found in schedule');
  }

  return {
    recipientEmails,
    emailSubject: payload?.subject || scheduleData.subject || 'Scheduled Report',
    emailMessage:
      payload?.message !== undefined ? payload.message : scheduleData.message || null,
    emailTextMessage:
      payload?.textMessage !== undefined ? payload.textMessage : null,
    emailHtmlMessage:
      payload?.htmlMessage !== undefined ? payload.htmlMessage : null,
    emailLayout: payload?.layout === 'plain' ? 'plain' : 'digest',
    dashboardLink: scheduleData.dashboardLink || 'https://semaphor.cloud',
    companyName: scheduleData.companyName || 'Semaphor',
    supportEmail: scheduleData.supportEmail || 'support@semaphor.cloud',
    senderEmail: scheduleData.senderEmail || config.sesSenderEmail,
  };
}

function buildDirectEmailContext(payload, config) {
  const recipientEmails = parseRecipientEmails(payload?.recipients || '');
  if (recipientEmails.length === 0) {
    throw new Error('No valid recipient emails found for direct email');
  }

  return {
    recipientEmails,
    emailSubject: payload?.subject || 'Report',
    emailMessage: payload?.message || null,
    emailTextMessage: payload?.textMessage || null,
    emailHtmlMessage: payload?.htmlMessage || null,
    emailLayout: payload?.layout === 'plain' ? 'plain' : 'digest',
    dashboardLink: payload?.dashboardLink || 'https://semaphor.cloud',
    companyName: payload?.companyName || 'Semaphor',
    supportEmail: payload?.supportEmail || 'support@semaphor.cloud',
    senderEmail: payload?.senderEmail || config.sesSenderEmail,
  };
}

function getLongestRecipient(recipients) {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return '';
  }

  return recipients.reduce(
    (longest, recipient) =>
      String(recipient || '').length > longest.length ? String(recipient || '') : longest,
    ''
  );
}

async function prepareEmailDelivery({
  artifacts,
  emailContext,
  provider,
  scheduleId,
  leaseOwner,
  config,
}) {
  let attachmentsForProvider = artifacts;
  let totalAttachmentBytes = 0;
  let usedLinkFallback = false;
  let downloadLinks = [];
  let estimatedSesRawSizeBytes = null;

  let emailBodies = buildEmailBodies({
    emailMessage: emailContext.emailMessage,
    emailTextMessage: emailContext.emailTextMessage,
    emailHtmlMessage: emailContext.emailHtmlMessage,
    emailLayout: emailContext.emailLayout,
    dashboardLink: emailContext.dashboardLink,
    companyName: emailContext.companyName,
    supportEmail: emailContext.supportEmail,
    downloadLinks,
  });

  if (provider.name === 'SES') {
    const resolved = await resolveAttachmentsWithSize(artifacts);
    const sizedArtifacts = resolved.attachments;
    totalAttachmentBytes = resolved.totalAttachmentBytes;
    const longestRecipient = getLongestRecipient(emailContext.recipientEmails);

    estimatedSesRawSizeBytes = estimateSesRawMessageSizeBytes({
      from: emailContext.senderEmail,
      to: longestRecipient ? [longestRecipient] : [],
      subject: emailContext.emailSubject,
      textBody: emailBodies.textBody,
      htmlBody: emailBodies.htmlBody,
      attachments: sizedArtifacts,
    });

    if (estimatedSesRawSizeBytes > config.emailMaxRawSizeBytes) {
      usedLinkFallback = true;
      attachmentsForProvider = [];
      downloadLinks = buildDownloadLinks(
        sizedArtifacts,
        config.attachmentLinkExpirySeconds
      );
      emailBodies = buildEmailBodies({
        emailMessage: emailContext.emailMessage,
        emailTextMessage: emailContext.emailTextMessage,
        emailHtmlMessage: emailContext.emailHtmlMessage,
        emailLayout: emailContext.emailLayout,
        dashboardLink: emailContext.dashboardLink,
        companyName: emailContext.companyName,
        supportEmail: emailContext.supportEmail,
        downloadLinks,
      });
    } else {
      const withBuffers = await attachSesBuffers(sizedArtifacts);
      attachmentsForProvider = withBuffers.attachments;
    }
  } else if (provider.name === 'EXTERNAL') {
    attachmentsForProvider = buildExternalPayloadAttachments(
      artifacts,
      EXTERNAL_PROVIDER_URL_EXPIRY_SECONDS
    );
  }

  return {
    attachmentsForProvider,
    totalAttachmentBytes,
    usedLinkFallback,
    estimatedSesRawSizeBytes,
    downloadLinkCount: downloadLinks.length,
    textBody: emailBodies.textBody,
    htmlBody: emailBodies.htmlBody,
    metadata: {
      scheduleId,
      leaseOwner,
      formats: artifacts.map((artifact) => artifact.format),
      usedLinkFallback,
      totalAttachmentBytes,
      estimatedSesRawSizeBytes,
    },
  };
}

function summarizeFailures(failures) {
  if (!Array.isArray(failures) || failures.length === 0) {
    return 'success';
  }

  return failures
    .map((failure) =>
      `${failure.recipient}${failure.error ? ` (${failure.error})` : ''}`
    )
    .join('; ');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableSendError(error) {
  const message = String(error || '').toLowerCase();

  return [
    'throttl',
    'rate exceeded',
    'maximum sending rate exceeded',
    'too many requests',
    'http 429',
    'http 500',
    'http 502',
    'http 503',
    'http 504',
    'timeout',
    'timed out',
    'socket hang up',
    'econnreset',
    'eai_again',
    'network',
  ].some((token) => message.includes(token));
}

async function sendWithRetry(sendAttempt, retryDelaysMs, sleepFn) {
  let lastResult = null;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    lastResult = await sendAttempt();

    if (lastResult.success || !isRetryableSendError(lastResult.error)) {
      return lastResult;
    }

    if (attempt < retryDelaysMs.length) {
      await sleepFn(retryDelaysMs[attempt]);
    }
  }

  return lastResult;
}

function createSendConsolidated(deps = {}) {
  return async function sendConsolidated(payload) {
    const config = deps.getEmailSenderConfig
      ? deps.getEmailSenderConfig()
      : getEmailSenderConfig();
    const provider = deps.buildProvider
      ? deps.buildProvider(config)
      : buildProvider(config);

    const scheduleId =
      typeof payload?.scheduleId === 'string' ? payload.scheduleId : null;
    const leaseOwner =
      typeof payload?.leaseOwner === 'string' ? payload.leaseOwner : null;
    const artifacts = deps.normalizeArtifacts
      ? deps.normalizeArtifacts(payload?.attachments)
      : normalizeArtifacts(payload?.attachments);

    const emailContext = scheduleId
      ? await (deps.buildScheduledEmailContext || buildScheduledEmailContext)(
          scheduleId,
          payload,
          config
        )
      : (deps.buildDirectEmailContext || buildDirectEmailContext)(payload, config);

    if (emailContext.recipientEmails.length === 0) {
      throw new Error('No recipients selected for sending');
    }

    const preparedDelivery = await (
      deps.prepareEmailDelivery || prepareEmailDelivery
    )({
      artifacts,
      emailContext,
      provider,
      scheduleId,
      leaseOwner,
      config,
    });

    const retryDelaysMs = Array.isArray(deps.sendRetryDelaysMs)
      ? deps.sendRetryDelaysMs
      : SEND_RETRY_DELAYS_MS;
    const sleepFn = deps.sleep || sleep;
    const recipientResults = [];

    for (const recipient of emailContext.recipientEmails) {
      const result = await sendWithRetry(
        async () => {
          try {
            const sendResult = await provider.send({
              from: emailContext.senderEmail,
              to: [recipient],
              subject: emailContext.emailSubject,
              textBody: preparedDelivery.textBody,
              htmlBody: preparedDelivery.htmlBody,
              attachments: preparedDelivery.attachmentsForProvider,
              metadata: preparedDelivery.metadata,
            });

            if (!sendResult.success) {
              return {
                success: false,
                recipient,
                providerMessageId: null,
                error: sendResult.error || 'Failed to send email',
              };
            }

            return {
              success: true,
              recipient,
              providerMessageId: sendResult.providerMessageId || null,
              error: null,
            };
          } catch (error) {
            return {
              success: false,
              recipient,
              providerMessageId: null,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        },
        retryDelaysMs,
        sleepFn
      );

      recipientResults.push(result);
    }

    const successfulDeliveries = recipientResults.filter((result) => result.success);
    const failedDeliveries = recipientResults.filter((result) => !result.success);
    const statusMessage =
      failedDeliveries.length === 0
        ? 'success'
        : `Failed to send to: ${summarizeFailures(failedDeliveries)}`;

    return {
      success: failedDeliveries.length === 0,
      allSucceeded: failedDeliveries.length === 0,
      provider: provider.name,
      providerMessageId:
        successfulDeliveries.length === 1
          ? successfulDeliveries[0].providerMessageId
          : null,
      providerMessageIds: successfulDeliveries
        .map((result) => result.providerMessageId)
        .filter(Boolean),
      scheduleId,
      leaseOwner,
      recipientCount: emailContext.recipientEmails.length,
      successCount: successfulDeliveries.length,
      failureCount: failedDeliveries.length,
      failedRecipients: failedDeliveries.map((result) => result.recipient),
      recipientResults,
      attachmentCount: artifacts.length,
      sentAttachmentCount: preparedDelivery.attachmentsForProvider.length,
      usedLinkFallback: preparedDelivery.usedLinkFallback,
      totalAttachmentBytes: preparedDelivery.totalAttachmentBytes,
      estimatedSesRawSizeBytes: preparedDelivery.estimatedSesRawSizeBytes,
      downloadLinkCount: preparedDelivery.downloadLinkCount,
      statusMessage,
    };
  };
}

const sendConsolidated = createSendConsolidated();

function isHttpFunctionUrlEvent(event) {
  return Boolean(event?.requestContext?.http || event?.rawPath);
}

function getHeader(headers, key) {
  const normalizedKey = key.toLowerCase();
  const entry = Object.entries(headers || {}).find(
    ([headerKey]) => headerKey.toLowerCase() === normalizedKey
  );
  return entry ? String(entry[1] || '') : '';
}

function timingSafeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}

function parseHttpBody(event) {
  if (typeof event?.body !== 'string' || event.body.trim().length === 0) {
    return {};
  }
  const body = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  return JSON.parse(body);
}

async function handleHttpFunctionUrlEvent(event) {
  const configuredSecret = String(process.env.LAMBDA_API_KEY || '').trim();
  if (!configuredSecret) {
    return jsonResponse(503, {
      success: false,
      error: 'LAMBDA_API_KEY is not configured',
    });
  }

  const providedSecret = getHeader(
    event.headers,
    'x-api-key'
  ).trim();
  if (
    !providedSecret ||
    !timingSafeEqualString(providedSecret, configuredSecret)
  ) {
    return jsonResponse(401, {
      success: false,
      error: 'Unauthorized',
    });
  }

  if ((event.requestContext?.http?.method || event.httpMethod) !== 'POST') {
    return jsonResponse(405, {
      success: false,
      error: 'Method not allowed',
    });
  }

  let payload;
  try {
    payload = parseHttpBody(event);
  } catch {
    return jsonResponse(400, {
      success: false,
      error: 'Request body must be valid JSON',
    });
  }

  if (payload?.action !== 'send_consolidated') {
    return jsonResponse(400, {
      success: false,
      error: 'Only send_consolidated is supported over HTTP',
    });
  }

  try {
    const result = await sendConsolidated(payload);
    return jsonResponse(200, result);
  } catch (error) {
    return jsonResponse(500, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

exports.handler = async (event) => {
  if (isHttpFunctionUrlEvent(event)) {
    return handleHttpFunctionUrlEvent(event);
  }

  if (event?.action === 'update_status') {
    if (!event?.scheduleId || !event?.status) {
      throw new Error('scheduleId and status are required for update_status');
    }

    await updateSubscriptionStatus(
      event.scheduleId,
      event.status,
      event.leaseOwner || null
    );

    return {
      success: true,
      scheduleId: event.scheduleId,
      status: event.status,
    };
  }

  if (event?.action === 'send_consolidated') {
    return sendConsolidated(event);
  }

  throw new Error('Unsupported EmailSender invocation payload');
};

async function updateSubscriptionStatus(scheduleId, status, leaseOwner = null) {
  const semaphorAppUrl = process.env.SEMAPHOR_APP_URL;
  if (!semaphorAppUrl) {
    throw new Error('SEMAPHOR_APP_URL environment variable is not set');
  }

  const lambdaApiKey = process.env.LAMBDA_API_KEY;
  if (!lambdaApiKey) {
    throw new Error('LAMBDA_API_KEY environment variable is not set');
  }

  const response = await fetch(`${semaphorAppUrl}/api/v1/schedules/update-status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': lambdaApiKey,
    },
    body: JSON.stringify({
      scheduleId,
      status,
      ...(leaseOwner ? { leaseOwner } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to update subscription status');
  }

  return response.json();
}

async function getScheduleDetails(scheduleId) {
  const semaphorAppUrl = process.env.SEMAPHOR_APP_URL;
  if (!semaphorAppUrl) {
    throw new Error('SEMAPHOR_APP_URL environment variable is not set');
  }

  const lambdaApiKey = process.env.LAMBDA_API_KEY;
  if (!lambdaApiKey) {
    throw new Error('LAMBDA_API_KEY environment variable is not set');
  }

  const response = await fetch(
    `${semaphorAppUrl}/api/v1/schedules/${scheduleId}/internal`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': lambdaApiKey,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get schedule details: ${response.status}`);
  }

  return response.json();
}

module.exports = {
  handler: exports.handler,
  createSendConsolidated,
  sendConsolidated,
  isRetryableSendError,
  prepareEmailDelivery,
  parseRecipientEmails,
  sendWithRetry,
  sleep,
  summarizeFailures,
};
