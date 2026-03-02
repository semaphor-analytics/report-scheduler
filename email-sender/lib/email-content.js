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
  downloadLinks = [],
}) {
  const hasLinks = Array.isArray(downloadLinks) && downloadLinks.length > 0;

  const linksText = hasLinks
    ? [
        '',
        'Download links:',
        ...downloadLinks.map(
          (item) =>
            `- ${item.name || 'Report'}${item.url ? `: ${item.url}` : ''}`
        ),
      ].join('\n')
    : '';

  const linksHtml = hasLinks
    ? [
        '<div style="margin-top: 16px;">',
        '<p style="font-size: 14px; margin-bottom: 8px;"><strong>Download links</strong></p>',
        '<ul style="padding-left: 18px; margin: 0;">',
        ...downloadLinks.map((item) => {
          const label = item.name || 'Report';
          const href = item.url || '#';
          return `<li style="margin: 6px 0; font-size: 14px;"><a href="${href}" style="color: #007bff; text-decoration: none;">${label}</a></li>`;
        }),
        '</ul>',
        '</div>',
      ].join('')
    : '';

  if (emailMessage) {
    return {
      textBody: `${emailMessage}${linksText}`,
      htmlBody: `<div style="font-size: 14px; white-space: pre-wrap;">${emailMessage.replace(
        /\n/g,
        '<br>'
      )}</div>${linksHtml}`,
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
      ...(hasLinks ? [linksText] : []),
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
      linksHtml,
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
  attachments = [],
}) {
  const normalizedAttachments = Array.isArray(attachments) ? attachments : [];

  const mixedBoundary =
    'MixedBoundary_' + Math.random().toString(36).substring(2);
  const altBoundary = 'AltBoundary_' + Math.random().toString(36).substring(2);

  const toHeader = Array.isArray(to) ? to.join(', ') : String(to);

  const rawParts = [
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
  ];

  for (const attachment of normalizedAttachments) {
    if (!attachment?.fileBuffer) {
      continue;
    }
    const base64File = Buffer.from(attachment.fileBuffer)
      .toString('base64')
      .match(/.{1,76}/g) || [];
    const base64Lines = Array.isArray(base64File)
      ? base64File.join('\r\n')
      : '';
    rawParts.push(
      `--${mixedBoundary}`,
      `Content-Type: ${attachment.contentType}; name="${attachment.name}"`,
      `Content-Disposition: attachment; filename="${attachment.name}"`,
      'Content-Transfer-Encoding: base64',
      '',
      base64Lines,
      ''
    );
  }

  rawParts.push(`--${mixedBoundary}--`);

  const rawEmail = rawParts.join('\r\n');

  return Buffer.from(rawEmail);
}

module.exports = {
  getAttachmentContentType,
  getAttachmentFilename,
  buildEmailBodies,
  createRawEmail,
};
