const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const ses = new AWS.SES({ region: 'us-east-1' }); // Match your region

exports.handler = async (event) => {
  const bucket = event.Records[0].s3.bucket.name;
  const key = decodeURIComponent(
    event.Records[0].s3.object.key.replace(/\+/g, ' ')
  );

  let scheduleId;

  try {
    const tagParams = { Bucket: bucket, Key: key };
    const tagData = await s3.getObjectTagging(tagParams).promise();
    const tags = tagData.TagSet.reduce((acc, tag) => {
      acc[tag.Key] = tag.Value;
      return acc;
    }, {});

    // Check if this is a scheduled report or direct email
    scheduleId = tags.scheduleId;
    let recipientEmail, emailSubject, emailMessage, dashboardLink, companyName, supportEmail, senderEmail;
    let attachmentName = tags.attachmentName || 'Report';
    let fileFormat = tags.format || 'pdf'; // Get format from tags

    // Detect format from S3 key if not in tags
    if (!tags.format) {
      if (key.endsWith('.csv')) {
        fileFormat = 'csv';
      } else if (key.endsWith('.pdf')) {
        fileFormat = 'pdf';
      }
    }

    if (scheduleId) {
      // Scheduled report - fetch details from internal endpoint
      console.log('Processing scheduled report:', scheduleId);
      console.log('Attachment name from tags:', attachmentName);
      console.log('File format:', fileFormat);

      try {
        const scheduleData = await getScheduleDetails(scheduleId);

        // Extract email details from schedule
        const recipients = tags.recipients || scheduleData.recipients || '';
        const recipientEmails = recipients
          .split(',')
          .map(email => email.trim())
          .filter(email => email && email.includes('@'));

        if (recipientEmails.length === 0) {
          throw new Error('No valid recipient emails found in schedule');
        }

        recipientEmail = recipientEmails[0]; // TODO: handle multiple recipients
        emailSubject = scheduleData.subject || 'Scheduled Report';
        emailMessage = scheduleData.message || null; // Get message from API
        dashboardLink = scheduleData.dashboardLink || 'https://semaphor.cloud';
        companyName = scheduleData.companyName || 'Semaphor';
        supportEmail = scheduleData.supportEmail || 'support@semaphor.cloud';
        senderEmail = scheduleData.senderEmail || 'Semaphor <noreply@semaphor.cloud>';
        
      } catch (error) {
        console.error('Failed to fetch schedule details:', error);
        throw new Error('Failed to fetch schedule details for scheduled report');
      }
      
    } else {
      // Direct email (non-scheduled) - use tag values
      console.log('Processing direct email request');
      
      const recipientEmailString = tags.email || '';
      emailSubject = tags.subject || 'Report';
      emailMessage = null; // No custom message for direct emails
      
      if (!recipientEmailString || !emailSubject) {
        throw new Error('Missing email or subject tags for direct email');
      }
      
      // Parse and validate recipient emails
      const recipientEmails = recipientEmailString
        .split(',')
        .map(email => email.trim())
        .filter(email => email && email.includes('@'));
      
      if (recipientEmails.length === 0) {
        throw new Error('No valid recipient emails found');
      }
      
      recipientEmail = recipientEmails[0];
      
      // Use defaults for direct emails
      dashboardLink = 'https://semaphor.cloud';
      companyName = 'Semaphor';
      supportEmail = 'support@semaphor.cloud';
      senderEmail = 'Semaphor <noreply@semaphor.cloud>';
    }

    const objectParams = { Bucket: bucket, Key: key };
    const objectData = await s3.getObject(objectParams).promise();
    const fileBuffer = objectData.Body;

    const emailParams = {
      //   Source: formattedSenderEmail, // Replace with your SES-verified email
      RawMessage: {
        Data: createRawEmail(
          recipientEmail,
          emailSubject,
          fileBuffer,
          fileFormat,
          attachmentName,
          emailMessage,
          senderEmail,
          dashboardLink,
          companyName,
          supportEmail
        ),
      },
    };

    await ses.sendRawEmail(emailParams).promise();
    console.log(
      `Email sent to ${recipientEmail} with subject: ${emailSubject}`
    );
    if (scheduleId) {
      await updateSubscriptionStatus(scheduleId, 'success');
    }
    return { statusCode: 200, body: 'Email sent successfully' };
  } catch (error) {
    console.error('Error:', error);
    if (scheduleId) {
      await updateSubscriptionStatus(scheduleId, 'error');
    }
    throw error;
  }
};

function createRawEmail(
  to,
  subject,
  fileBuffer,
  fileFormat = 'pdf',
  attachmentName = 'Report',
  emailMessage = null,
  senderEmail,
  dashboardLink,
  companyName = 'Semaphor',
  supportEmail = 'support@semaphor.cloud'
) {
  const mixedBoundary =
    'MixedBoundary_' + Math.random().toString(36).substring(2);
  const altBoundary = 'AltBoundary_' + Math.random().toString(36).substring(2);
  const base64File = fileBuffer
    .toString('base64')
    .match(/.{1,76}/g)
    .join('\r\n');

  const currentDate = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const rawEmail = [
    `From: ${senderEmail}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    '',

    // Message Body (Plain Text + HTML)
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    '',

    // Plain Text Version (comes first, as fallback)
    `--${altBoundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    // Use custom message if provided, otherwise use default
    ...(emailMessage
      ? [
          ...emailMessage.split('\n') // Use the custom message
        ]
      : [
          `Hello,`,
          '',
          `Attached is your scheduled report from ${companyName}.`,
          '',
          `View your dashboard online: ${dashboardLink}`,
          '',
          `This is an automated email from a no-reply address. If you have any questions, please contact ${supportEmail}.`,
          '',
          `Cheers,`,
          `${companyName} Team`,
          ''
        ]
    ),

    // HTML Version (comes second, preferred by Gmail)
    `--${altBoundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    '<html>',
    '<head><meta charset="UTF-8"></head>',
    '<body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; padding-left: 25px; padding-right: 25px; padding-top: 15px; padding-bottom: 15px;">',
    ...(emailMessage
      ? [
          // Convert plain text message to HTML, preserving line breaks
          `<div style="font-size: 14px; white-space: pre-wrap;">${emailMessage.replace(/\n/g, '<br>')}</div>`
        ]
      : [
          '<p style="font-size: 14px;">Hello,</p>',
          `<p style="font-size: 14px;">Attached is your scheduled report from ${companyName}.</p>`,
          `<p style="font-size: 14px;"><a href="${dashboardLink}" style="color: #007bff; text-decoration: none;">View your dashboard online</a></p>`,
          `<p style="font-size: 14px;">This is an automated email from a no-reply address. If you have any questions, please contact <a href="mailto:${supportEmail}" style="color: #007bff; text-decoration: none;">${supportEmail}</a>.</p>`,
          `<p style="font-size: 14px;">Cheers,<br>${companyName} Team</p>`,
        ]
    ),
    '</body>',
    '</html>',
    '',
    `--${altBoundary}--`,
    '',

    // File Attachment
    `--${mixedBoundary}`,
    `Content-Type: ${fileFormat === 'csv' ? 'text/csv' : 'application/pdf'}; name="${attachmentName}_${currentDate}.${fileFormat}"`,
    `Content-Disposition: attachment; filename="${attachmentName}_${currentDate}.${fileFormat}"`,
    'Content-Transfer-Encoding: base64',
    '',
    base64File,
    '',
    `--${mixedBoundary}--`,
  ].join('\r\n');

  return Buffer.from(rawEmail);
}

function createRawEmail_working_iphone_not_gmail(
  to,
  subject,
  pdfBuffer,
  formattedSenderEmail,
  dashboardLink,
  companyName = 'Semaphor',
  supportEmail = 'support@semaphor.cloud'
) {
  const mixedBoundary =
    'MixedBoundary_' + Math.random().toString(36).substring(2); // Unique boundary
  const altBoundary = 'AltBoundary_' + Math.random().toString(36).substring(2); // Unique boundary
  const base64Pdf = pdfBuffer
    .toString('base64')
    .match(/.{1,76}/g)
    .join('\r\n'); // Splits into 76-char lines

  const currentDate = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const rawEmail = [
    `From: ${formattedSenderEmail}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`, // Outer mixed structure
    '',

    // Alternative Part (Text + HTML)
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    '',

    // Plain Text Version
    `--${altBoundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable', // Safer for special chars
    '',
    `Hello,`,
    '',
    `Attached is your latest dashboard report from ${companyName}.`,
    '',
    `View your dashboard online: ${dashboardLink}`,
    '',
    `This is an automated email from a no-reply address. If you have any questions, please contact ${supportEmail}.`,
    '',
    `Best,`,
    `${companyName} Team`,
    '',

    // HTML Version with Inline Styles
    `--${altBoundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable', // Safer for special chars
    '',
    '<html>',
    '<body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; padding: 20px;">',
    '<p style="font-size: 14px;">Hello,</p>',
    `<p style="font-size: 14px;">Attached is your latest dashboard report from ${companyName}.</p>`,
    `<p style="font-size: 14px;"><a href="${dashboardLink}" style="color: #007bff; text-decoration: none;">View your dashboard online</a></p>`,
    `<p style="font-size: 14px;">This is an automated email from a no-reply address. If you have any questions, please contact <a href="mailto:${supportEmail}" style="color: #007bff; text-decoration: none;">${supportEmail}</a>.</p>`,
    `<p style="font-size: 14px;">Best,<br><strong>${companyName} Team</strong></p>`,
    '</body>',
    '</html>',
    '',
    `--${altBoundary}--`, // Close alternative part
    '',

    // Attachment (PDF)
    `--${mixedBoundary}`,
    `Content-Type: application/pdf; name="dashboard_report_${currentDate}.pdf"`,
    `Content-Disposition: attachment; filename="dashboard_report_${currentDate}.pdf"`,
    'Content-Transfer-Encoding: base64',
    '',
    base64Pdf,
    '',
    `--${mixedBoundary}--`, // Close mixed part
  ].join('\r\n');

  return Buffer.from(rawEmail);
}

function createRawEmai_working_gmail_notworking_iphone(
  to,
  subject,
  pdfBuffer,
  formattedSenderEmail,
  dashboardLink,
  unsubscribeLink,
  companyName = 'Semaphor',
  supportEmail = 'support@semaphor.cloud'
) {
  const boundary = 'NextPart';
  const base64Pdf = pdfBuffer
    .toString('base64')
    .match(/.{1,76}/g)
    .join('\r\n'); // Splits into 76-char lines

  const currentDate = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const rawEmail = [
    `From: ${formattedSenderEmail}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`, // Allows plain text & HTML
    '',

    // Plain Text Version
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    `Hello,`,
    '',
    `Attached is your latest dashboard report from ${companyName}.`,
    '',
    `View your dashboard online: ${dashboardLink}`,
    '',
    `This is an automated email from a no-reply address. If you have any questions, please contact ${supportEmail}.`,
    '',
    `Best,`,
    `${companyName} Team`,
    '',

    // HTML Version with Inline Styles
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    '<html>',
    '<body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; padding: 20px;">',
    '<p style="font-size: 14px;">Hello,</p>',
    `<p style="font-size: 14px;">Attached is your latest dashboard report from ${companyName}.</p>`,

    `<p style="font-size: 14px;"><a href="${dashboardLink}" style="color: #007bff; text-decoration: none;">View your dashboard online</a></p>`,


    `<p style="font-size: 14px;">This is an automated email from a no-reply address. If you have any questions, please contact <a href="mailto:${supportEmail}" style="color: #007bff; text-decoration: none;">${supportEmail}</a>.</p>`,

    `<p style="font-size: 14px;">Best,<br><strong>${companyName} Team</strong></p>`,
    '</body>',
    '</html>',
    '',

    // Attachment (PDF)
    `--${boundary}`,
    `Content-Type: application/pdf; name="dashboard_report_${currentDate}.pdf"`,
    `Content-Disposition: attachment; filename="dashboard_report_${currentDate}.pdf"`,
    'Content-Transfer-Encoding: base64',
    '',
    base64Pdf, // Encoded PDF
    '',
    `--${boundary}--`,
  ].join('\r\n');

  return Buffer.from(rawEmail);
}

function createRawEmail_working(to, subject, pdfBuffer, formattedSenderEmail) {
  const boundary = 'NextPart';
  const rawEmail = [
    `From: ${formattedSenderEmail}`, // Replace with your SES-verified email
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    'Attached is the PDF you requested.',
    '',
    `--${boundary}`,
    'Content-Type: application/pdf; name="document.pdf"',
    'Content-Disposition: attachment; filename="document.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    pdfBuffer.toString('base64'),
    `--${boundary}--`,
  ].join('\r\n');
  return Buffer.from(rawEmail);
}

async function updateSubscriptionStatus(scheduleId, status) {
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
      'X-API-Key': lambdaApiKey
    },
    body: JSON.stringify({
      scheduleId,
      status,
    }),
  });

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
        'X-API-Key': lambdaApiKey
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get schedule details: ${response.status}`);
  }
  const data = await response.json();
  return data;
}
