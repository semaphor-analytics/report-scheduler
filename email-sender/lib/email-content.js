function getAttachmentContentType(fileFormat) {
  return fileFormat === 'csv' ? 'text/csv' : 'application/pdf';
}

function getAttachmentFilename(attachmentName, fileFormat) {
  const currentDate = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return `${attachmentName}_${currentDate}.${fileFormat}`;
}

function buildEmailBodies({
  emailMessage = null,
  dashboardLink,
  companyName = 'Semaphor',
  supportEmail = 'support@semaphor.cloud',
}) {
  if (emailMessage) {
    return {
      textBody: emailMessage,
      htmlBody: `<div style="font-size: 14px; white-space: pre-wrap;">${emailMessage.replace(
        /\n/g,
        '<br>'
      )}</div>`,
    };
  }

  return {
    textBody: [
      'Hello,',
      '',
      `Attached is your scheduled report from ${companyName}.`,
      '',
      `View your dashboard online: ${dashboardLink}`,
      '',
      `This is an automated email from a no-reply address. If you have any questions, please contact ${supportEmail}.`,
      '',
      'Cheers,',
      `${companyName} Team`,
      '',
    ].join('\n'),
    htmlBody: [
      '<p style="font-size: 14px;">Hello,</p>',
      `<p style="font-size: 14px;">Attached is your scheduled report from ${companyName}.</p>`,
      `<p style="font-size: 14px;"><a href="${dashboardLink}" style="color: #007bff; text-decoration: none;">View your dashboard online</a></p>`,
      `<p style="font-size: 14px;">This is an automated email from a no-reply address. If you have any questions, please contact <a href="mailto:${supportEmail}" style="color: #007bff; text-decoration: none;">${supportEmail}</a>.</p>`,
      `<p style="font-size: 14px;">Cheers,<br>${companyName} Team</p>`,
    ].join(''),
  };
}

function createRawEmail({
  from,
  to,
  subject,
  textBody,
  htmlBody,
  attachmentFilename,
  attachmentContentType,
  fileBuffer,
}) {
  const mixedBoundary =
    'MixedBoundary_' + Math.random().toString(36).substring(2);
  const altBoundary = 'AltBoundary_' + Math.random().toString(36).substring(2);
  const base64File = fileBuffer
    .toString('base64')
    .match(/.{1,76}/g)
    .join('\r\n');

  const toHeader = Array.isArray(to) ? to.join(', ') : String(to);

  const rawEmail = [
    `From: ${from}`,
    `To: ${toHeader}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    '',
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    '',
    `--${altBoundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    ...String(textBody).split('\n'),
    '',
    `--${altBoundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    '<html>',
    '<head><meta charset="UTF-8"></head>',
    '<body style="font-family: Arial, sans-serif; color: #333; line-height: 1.6; padding-left: 25px; padding-right: 25px; padding-top: 15px; padding-bottom: 15px;">',
    htmlBody,
    '</body>',
    '</html>',
    '',
    `--${altBoundary}--`,
    '',
    `--${mixedBoundary}`,
    `Content-Type: ${attachmentContentType}; name="${attachmentFilename}"`,
    `Content-Disposition: attachment; filename="${attachmentFilename}"`,
    'Content-Transfer-Encoding: base64',
    '',
    base64File,
    '',
    `--${mixedBoundary}--`,
  ].join('\r\n');

  return Buffer.from(rawEmail);
}

module.exports = {
  getAttachmentContentType,
  getAttachmentFilename,
  buildEmailBodies,
  createRawEmail,
};
