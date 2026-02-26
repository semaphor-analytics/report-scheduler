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

function getObjectKeyFromEvent(event) {
  const record = event?.Records?.[0];
  if (!record?.s3?.bucket?.name || !record?.s3?.object?.key) {
    throw new Error('Invalid S3 event payload for email sender');
  }

  const bucket = record.s3.bucket.name;
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
  return { bucket, key };
}

function parseRecipientEmails(rawRecipients) {
  return String(rawRecipients || '')
    .split(',')
    .map((email) => email.trim())
    .filter((email) => email && email.includes('@'));
}

function detectFileFormat(tags, key) {
  if (tags.format) {
    return tags.format;
  }

  if (key.endsWith('.csv')) {
    return 'csv';
  }

  return 'pdf';
}

function getTagMap(tagData) {
  return tagData.TagSet.reduce((acc, tag) => {
    acc[tag.Key] = tag.Value;
    return acc;
  }, {});
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

function buildDirectEmailContext(tags, config) {
  const recipientEmails = parseRecipientEmails(tags.email || '');
  if (recipientEmails.length === 0) {
    throw new Error('No valid recipient emails found for direct email');
  }

  return {
    recipientEmails,
    emailSubject: tags.subject || 'Report',
    emailMessage: null,
    dashboardLink: 'https://semaphor.cloud',
    companyName: 'Semaphor',
    supportEmail: 'support@semaphor.cloud',
    senderEmail: config.sesSenderEmail,
  };
}

async function buildScheduledEmailContext(scheduleId, tags, config) {
  const scheduleData = await getScheduleDetails(scheduleId);
  const recipientEmails = parseRecipientEmails(
    tags.recipients || scheduleData.recipients || ''
  );

  if (recipientEmails.length === 0) {
    throw new Error('No valid recipient emails found in schedule');
  }

  return {
    recipientEmails,
    emailSubject: scheduleData.subject || 'Scheduled Report',
    emailMessage: scheduleData.message || null,
    dashboardLink: scheduleData.dashboardLink || 'https://semaphor.cloud',
    companyName: scheduleData.companyName || 'Semaphor',
    supportEmail: scheduleData.supportEmail || 'support@semaphor.cloud',
    senderEmail: scheduleData.senderEmail || config.sesSenderEmail,
  };
}

exports.handler = async (event) => {
  const { bucket, key } = getObjectKeyFromEvent(event);
  const config = getEmailSenderConfig();

  let scheduleId = null;
  let leaseOwner = null;

  try {
    const tagData = await s3
      .getObjectTagging({ Bucket: bucket, Key: key })
      .promise();
    const tags = getTagMap(tagData);

    scheduleId = tags.scheduleId || null;
    leaseOwner = tags.leaseOwner || null;

    const fileFormat = detectFileFormat(tags, key);
    const attachmentName = tags.attachmentName || 'Report';

    const emailContext = scheduleId
      ? await buildScheduledEmailContext(scheduleId, tags, config)
      : buildDirectEmailContext(tags, config);

    const recipientsToSend = selectRecipients(
      emailContext.recipientEmails,
      config.emailEnableMultiRecipients
    );

    if (recipientsToSend.length === 0) {
      throw new Error('No recipients selected for sending');
    }

    const { textBody, htmlBody } = buildEmailBodies({
      emailMessage: emailContext.emailMessage,
      dashboardLink: emailContext.dashboardLink,
      companyName: emailContext.companyName,
      supportEmail: emailContext.supportEmail,
    });

    const attachmentFilename = getAttachmentFilename(attachmentName, fileFormat);

    const message = {
      from: emailContext.senderEmail,
      to: recipientsToSend,
      subject: emailContext.emailSubject,
      textBody,
      htmlBody,
      attachment: {
        name: attachmentFilename,
        contentType: getAttachmentContentType(fileFormat),
        format: fileFormat,
        s3Bucket: bucket,
        s3Key: key,
      },
      metadata: {
        scheduleId,
        leaseOwner,
        format: fileFormat,
      },
    };

    const provider = buildProvider(config);

    if (provider.requiresFileBuffer) {
      const objectData = await s3.getObject({ Bucket: bucket, Key: key }).promise();
      message.attachment.fileBuffer = Buffer.isBuffer(objectData.Body)
        ? objectData.Body
        : Buffer.from(objectData.Body || '');
    }

    const result = await provider.send(message);

    if (!result.success) {
      throw new Error(result.error || 'Failed to send email');
    }

    console.log('Email sent successfully', {
      provider: provider.name,
      recipients: recipientsToSend,
      subject: emailContext.emailSubject,
      providerMessageId: result.providerMessageId || null,
      scheduleId,
    });

    if (scheduleId) {
      await updateSubscriptionStatus(scheduleId, 'success', leaseOwner);
    }

    return { statusCode: 200, body: 'Email sent successfully' };
  } catch (error) {
    console.error('Error in email sender:', error);

    if (scheduleId) {
      try {
        await updateSubscriptionStatus(scheduleId, 'error', leaseOwner);
      } catch (updateError) {
        console.error('Failed to update schedule error status:', updateError);
      }
    }

    throw error;
  }
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

  const response = await fetch(
    `${semaphorAppUrl}/api/v1/schedules/update-status`,
    {
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
    }
  );

  if (!response.ok) {
    throw new Error('Failed to update subscription status');
  }

  const data = await response.json();
  console.log('Subscription status updated:', data);
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
