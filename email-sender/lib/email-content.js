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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function isFullHtmlDocument(html) {
  return /<html[\s>]/i.test(String(html || ''));
}

function wrapEmailHtml(innerHtml) {
  const content = String(innerHtml || '');

  if (isFullHtmlDocument(content)) {
    return content;
  }

  // Cardless layout: content flows directly inside the client chrome rather
  // than being wrapped in a bordered card. Modern digest emails (Stripe,
  // Linear, GitHub) follow this pattern because (a) every email client
  // already gives the message its own visual frame, (b) Gmail's sanitizer
  // strips card decorations inconsistently, and (c) it matches the brand's
  // hairline/quiet aesthetic.
  //
  // Font-family inner quotes use HTML entities — embedding raw double quotes
  // inside a double-quoted style attribute corrupts the attribute and Gmail
  // drops the whole `style` (which is why padding disappeared in Gmail web).
  const bodyFont =
    '&quot;Open Sans&quot;, Arial, &quot;Helvetica Neue&quot;, Helvetica, sans-serif';
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<meta name="x-apple-disable-message-reformatting">',
    '<style>',
    '@media screen and (max-width: 600px) {',
    '  .email-gutter { padding: 0 !important; }',
    '  .email-content { padding: 22px 18px !important; font-size: 18px !important; line-height: 1.6 !important; }',
    // Inline font-size on each <p>/<li>/<td> beats the .email-content rule
    // above unless we name the descendant tag with !important. Without these
    // descendant selectors, iPhone Mail renders body text at the inline 16px
    // instead of the mobile-bumped size, leaving text uncomfortably small.
    '  .email-content p { font-size: 18px !important; line-height: 1.6 !important; }',
    '  .email-content li { font-size: 18px !important; line-height: 1.55 !important; }',
    '  .email-content td { font-size: 18px !important; line-height: 1.55 !important; }',
    '  .email-content th { font-size: 13px !important; }',
    '  .email-content h1 { font-size: 26px !important; line-height: 1.2 !important; }',
    '  .email-content h2 { font-size: 13px !important; line-height: 1.4 !important; }',
    // Wide briefing tables would otherwise force iOS Mail to scale the entire
    // document down to fit. Hiding mid-table columns under 600px keeps the
    // identity column + the trailing metric columns visible without horizontal
    // scrolling. The .briefing-table-scroll wrapper is the safety net for
    // tables that still overflow after the hide.
    '  .briefing-col-hide-mobile { display: none !important; }',
    '  .briefing-table-scroll { margin: 14px 0 !important; }',
    // KPI grid: 2-up on desktop, 1-up on mobile. display:block on each tile
    // forces the table cells to stack; width:100% restores full-width tiles.
    // Outlook (which ignores @media) keeps the 2-up arrangement, which is
    // acceptable since it never renders on phones.
    '  .email-kpi-tile { display: block !important; width: 100% !important; box-sizing: border-box !important; margin-bottom: 8px !important; }',
    '  .email-kpi-value { font-size: 24px !important; }',
    '}',
    '</style>',
    '</head>',
    '<body style="margin: 0; padding: 0; background: #ffffff; color: #202124; -webkit-text-size-adjust: 100%; text-size-adjust: 100%;">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width: 100%; border-collapse: collapse; background: #ffffff;">',
    '<tr>',
    '<td class="email-gutter" align="center" style="padding: 0;">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width: 100%; max-width: 680px; border-collapse: collapse; background: #ffffff;">',
    '<tr>',
    `<td class="email-content" style="padding: 28px 32px; font-family: ${bodyFont}; font-size: 16px; line-height: 1.6; color: #202124;">`,
    content,
    '</td>',
    '</tr>',
    '</table>',
    '</td>',
    '</tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('');
}

function appendHtmlBeforeBodyClose(html, addition) {
  const document = String(html || '');
  const fragment = String(addition || '');

  if (!fragment) {
    return document;
  }

  if (!isFullHtmlDocument(document)) {
    return `${document}${fragment}`;
  }

  if (/<\/body>/i.test(document)) {
    return document.replace(/<\/body>/i, `${fragment}</body>`);
  }

  return document.replace(/<\/html>/i, `${fragment}</html>`);
}

function buildEmailBodies({
  emailMessage = null,
  emailTextMessage = null,
  emailHtmlMessage = null,
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
        '<p style="font-size: 15px; line-height: 1.5; margin: 0 0 8px;"><strong>Download links</strong></p>',
        '<ul style="padding-left: 18px; margin: 0;">',
        ...downloadLinks.map((item) => {
          const label = escapeHtml(item.name || 'Report');
          const href = escapeAttribute(item.url || '#');
          return `<li style="margin: 6px 0; font-size: 15px; line-height: 1.5;"><a href="${href}" style="color: #0b57d0; text-decoration: none;">${label}</a></li>`;
        }),
        '</ul>',
        '</div>',
      ].join('')
    : '';

  if (emailHtmlMessage) {
    const textMessage = emailTextMessage || emailMessage || '';
    const htmlMessage = appendHtmlBeforeBodyClose(emailHtmlMessage, linksHtml);
    return {
      textBody: `${textMessage}${linksText}`,
      htmlBody: wrapEmailHtml(htmlMessage),
    };
  }

  if (emailMessage) {
    const textMessage = emailTextMessage || emailMessage;
    const escapedMessage = escapeHtml(textMessage).replace(/\n/g, '<br>');
    return {
      textBody: `${textMessage}${linksText}`,
      htmlBody: wrapEmailHtml(
        `<div style="font-size: 16px; line-height: 1.6; color: #202124;">${escapedMessage}</div>${linksHtml}`
      ),
    };
  }

  const safeCompanyName = escapeHtml(companyName);
  const safeDashboardLink = escapeAttribute(dashboardLink || '#');
  const safeSupportEmail = escapeAttribute(supportEmail);
  const safeSupportEmailText = escapeHtml(supportEmail);

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
    htmlBody: wrapEmailHtml(
      [
        '<p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hello,</p>',
        `<p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Attached is your scheduled report from ${safeCompanyName}.</p>`,
        `<p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;"><a href="${safeDashboardLink}" style="color: #0b57d0; text-decoration: none;">View your dashboard online</a></p>`,
        `<p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">This is an automated email from a no-reply address. If you have any questions, please contact <a href="mailto:${safeSupportEmail}" style="color: #0b57d0; text-decoration: none;">${safeSupportEmailText}</a>.</p>`,
        linksHtml,
        `<p style="font-size: 16px; line-height: 1.6; margin: 16px 0 0;">Cheers,<br>${safeCompanyName} Team</p>`,
      ].join('')
    ),
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
    wrapEmailHtml(htmlBody),
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
  wrapEmailHtml,
  appendHtmlBeforeBodyClose,
};
