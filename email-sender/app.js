const AWS = require('aws-sdk');
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

function selectRecipients(recipientEmails, enableMultiRecipients) {
  if (enableMultiRecipients) {
    return recipientEmails;
  }

  return recipientEmails.length > 0 ? [recipientEmails[0]] : [];
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
    dashboardLink: payload?.dashboardLink || 'https://semaphor.cloud',
    companyName: payload?.companyName || 'Semaphor',
    supportEmail: payload?.supportEmail || 'support@semaphor.cloud',
    senderEmail: payload?.senderEmail || config.sesSenderEmail,
  };
}

async function sendConsolidated(payload) {
  const config = getEmailSenderConfig();
  const provider = buildProvider(config);

  const scheduleId =
    typeof payload?.scheduleId === 'string' ? payload.scheduleId : null;
  const leaseOwner =
    typeof payload?.leaseOwner === 'string' ? payload.leaseOwner : null;
  const artifacts = normalizeArtifacts(payload?.attachments);

  if (artifacts.length === 0) {
    throw new Error('At least one attachment is required');
  }

  const emailContext = scheduleId
    ? await buildScheduledEmailContext(scheduleId, payload, config)
    : buildDirectEmailContext(payload, config);

  const recipientsToSend = selectRecipients(
    emailContext.recipientEmails,
    config.emailEnableMultiRecipients
  );

  if (recipientsToSend.length === 0) {
    throw new Error('No recipients selected for sending');
  }

  let attachmentsForProvider = artifacts;
  let totalAttachmentBytes = 0;
  let usedLinkFallback = false;
  let downloadLinks = [];
  let estimatedSesRawSizeBytes = null;

  let emailBodies = buildEmailBodies({
    emailMessage: emailContext.emailMessage,
    dashboardLink: emailContext.dashboardLink,
    companyName: emailContext.companyName,
    supportEmail: emailContext.supportEmail,
    downloadLinks,
  });

  if (provider.name === 'SES') {
    const resolved = await resolveAttachmentsWithSize(artifacts);
    const sizedArtifacts = resolved.attachments;
    totalAttachmentBytes = resolved.totalAttachmentBytes;

    estimatedSesRawSizeBytes = estimateSesRawMessageSizeBytes({
      from: emailContext.senderEmail,
      to: recipientsToSend,
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
        dashboardLink: emailContext.dashboardLink,
        companyName: emailContext.companyName,
        supportEmail: emailContext.supportEmail,
        downloadLinks,
      });
    } else {
      const withBuffers = await attachSesBuffers(sizedArtifacts);
      attachmentsForProvider = withBuffers.attachments;
    }
  }

  const { textBody, htmlBody } = emailBodies;

  const message = {
    from: emailContext.senderEmail,
    to: recipientsToSend,
    subject: emailContext.emailSubject,
    textBody,
    htmlBody,
    attachments: attachmentsForProvider,
    metadata: {
      scheduleId,
      leaseOwner,
      formats: artifacts.map((artifact) => artifact.format),
      usedLinkFallback,
      totalAttachmentBytes,
      estimatedSesRawSizeBytes,
    },
  };

  const result = await provider.send(message);
  if (!result.success) {
    throw new Error(result.error || 'Failed to send email');
  }

  return {
    success: true,
    provider: provider.name,
    providerMessageId: result.providerMessageId || null,
    scheduleId,
    leaseOwner,
    recipientCount: recipientsToSend.length,
    attachmentCount: artifacts.length,
    sentAttachmentCount: attachmentsForProvider.length,
    usedLinkFallback,
    totalAttachmentBytes,
    estimatedSesRawSizeBytes,
    downloadLinkCount: downloadLinks.length,
  };
}

exports.handler = async (event) => {
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
