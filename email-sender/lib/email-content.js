const {
  encodeRfc2047Header,
  stripHeaderLineBreaks,
} = require('./envelope');

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

function wrapEmailHtml(innerHtml, layout = 'digest') {
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
  const plainLayout = layout === 'plain';
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
    `<td class="email-gutter" align="${plainLayout ? 'left' : 'center'}" style="padding: 0;">`,
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width: 100%; ${plainLayout ? '' : 'max-width: 680px; '}border-collapse: collapse; background: #ffffff;">`,
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

function buildBaseEmailBodies({
  emailMessage = null,
  emailTextMessage = null,
  emailHtmlMessage = null,
  dashboardLink,
  companyName = 'Semaphor',
  supportEmail = 'support@semaphor.cloud',
  downloadLinks = [],
  emailLayout = 'digest',
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
      htmlBody: wrapEmailHtml(htmlMessage, emailLayout),
    };
  }

  if (emailMessage) {
    const textMessage = emailTextMessage || emailMessage;
    const escapedMessage = escapeHtml(textMessage).replace(/\n/g, '<br>');
    return {
      textBody: `${textMessage}${linksText}`,
      htmlBody: wrapEmailHtml(
        `<div style="font-size: 16px; line-height: 1.6; color: #202124;">${escapedMessage}</div>${linksHtml}`,
        emailLayout
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
      ].join(''),
      emailLayout
    ),
  };
}

function insertHtmlAfterBodyOpen(html, addition) {
  const document = String(html || '');
  const fragment = String(addition || '');

  if (!fragment) {
    return document;
  }

  if (!isFullHtmlDocument(document)) {
    return `${fragment}${document}`;
  }

  if (/<body(?:\s[^>]*)?>/iu.test(document)) {
    return document.replace(
      /<body(?:\s[^>]*)?>/iu,
      (openingBody) => `${openingBody}${fragment}`
    );
  }

  if (/<\/head>/iu.test(document)) {
    return document.replace(/<\/head>/iu, `</head>${fragment}`);
  }

  return document.replace(
    /<html(?:\s[^>]*)?>/iu,
    (openingHtml) => `${openingHtml}${fragment}`
  );
}

function authoredTextToHtml(value) {
  return escapeHtml(value).replace(/\r\n|\r|\n/gu, '<br>');
}

// Branded emails follow the Semaphor product look: one quiet white card with a
// hairline zinc border and 6px radius, the organization name in the accent
// color beside the logo, the author's message in the middle, and a small grey
// footer under a hairline. The header fragment opens the card and the footer
// fragment always closes it, so the base body (author message, download
// links, digest content) sits inside untouched.
//
// KEEP IN SYNC: semaphor-app/src/lib/email-branding/email-template.ts is a
// TypeScript copy of wrapEmailHtml, the escape helpers, the insertion helpers,
// and everything from here to renderBrandedEmail, so the Brand Studio preview
// shows exactly what this Lambda sends. Both repositories commit the same
// golden fixture (test-fixtures/branded-plain-sample.json here) and fail their
// tests when either copy drifts. Change both in the same change set.
const BRAND_FONT =
  '&quot;Open Sans&quot;, Arial, &quot;Helvetica Neue&quot;, Helvetica, sans-serif';
const BRAND_CARD_BORDER = '#e4e4e7';
const BRAND_HAIRLINE = '#f4f4f5';
const BRAND_TEXT = '#202124';
const BRAND_MUTED = '#71717a';

// Mobile gutters for the brand cells must match the base content's 18px so the
// header, intro, message, and footer stay flush on phones. Inserted into <head>
// by the branded renderer only; unbranded documents stay byte-for-byte as is.
const BRAND_MOBILE_STYLE =
  '<style>@media screen and (max-width: 600px) { .email-brand-cell { padding-left: 18px !important; padding-right: 18px !important; } .email-brand-card { border-radius: 0 !important; border-left: 0 !important; border-right: 0 !important; } }</style>';

function insertHtmlBeforeHeadClose(html, addition) {
  const document = String(html || '');
  const fragment = String(addition || '');
  if (!fragment || !/<\/head>/iu.test(document)) {
    return document;
  }
  return document.replace(/<\/head>/iu, `${fragment}</head>`);
}

function buildBrandHeaderHtml(branding, emailLayout) {
  const plainLayout = emailLayout === 'plain';
  const alignment = plainLayout ? 'left' : 'center';
  const cardMaxWidth = plainLayout ? '600px' : '680px';
  const logo = branding.logoUrl
    ? `<img src="${escapeAttribute(branding.logoUrl)}" alt="" width="24" style="display: inline-block; width: 24px; max-width: 24px; height: auto; margin: 0 10px 0 0; vertical-align: middle; border: 0;">`
    : '';

  return [
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width: 100%; border-collapse: collapse; background: #ffffff;">',
    '<tr>',
    `<td class="email-gutter" align="${alignment}" style="padding: 24px;">`,
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="email-brand-card" style="width: 100%; max-width: ${cardMaxWidth}; border-collapse: separate; border: 1px solid ${BRAND_CARD_BORDER}; border-radius: 6px; background: #ffffff;">`,
    '<tr>',
    '<td style="padding: 0;">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width: 100%; border-collapse: collapse;">',
    '<tr>',
    `<td align="left" class="email-brand-cell" style="padding: 20px 32px 16px; border-bottom: 1px solid ${BRAND_HAIRLINE}; font-family: ${BRAND_FONT};">`,
    logo,
    `<span style="font-size: 16px; line-height: 1.4; font-weight: 600; letter-spacing: -0.01em; color: ${escapeAttribute(branding.accentColor)}; vertical-align: middle;">${escapeHtml(branding.fromName)}</span>`,
    '</td>',
    '</tr>',
    '</table>',
    branding.intro
      ? [
          '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width: 100%; border-collapse: collapse;">',
          '<tr>',
          `<td align="left" class="email-brand-cell" style="padding: 20px 32px 0; font-family: ${BRAND_FONT}; font-size: 16px; line-height: 1.6; color: ${BRAND_TEXT};">${authoredTextToHtml(branding.intro)}</td>`,
          '</tr>',
          '</table>',
        ].join('')
      : '',
  ].join('');
}

function buildBrandFooterHtml(branding) {
  const button = branding.callToAction
    ? [
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width: 100%; border-collapse: collapse;">',
        '<tr>',
        '<td align="left" class="email-brand-cell" style="padding: 0 32px 24px;">',
        '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse: separate; display: inline-table;"><tr>',
        `<td bgcolor="${escapeAttribute(branding.accentColor)}" style="border-radius: 5px; background: ${escapeAttribute(branding.accentColor)};">`,
        `<a href="${escapeAttribute(branding.callToAction.url)}" style="display: inline-block; padding: 10px 16px; color: #ffffff; font-family: ${BRAND_FONT}; font-size: 14px; line-height: 1.2; font-weight: 500; text-decoration: none;">${escapeHtml(branding.callToAction.label)}</a>`,
        '</td></tr></table>',
        '</td>',
        '</tr>',
        '</table>',
      ].join('')
    : '';
  const footer = branding.footer
    ? [
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width: 100%; border-collapse: collapse;">',
        '<tr>',
        `<td align="left" class="email-brand-cell" style="padding: 16px 32px 24px; border-top: 1px solid ${BRAND_HAIRLINE}; font-family: ${BRAND_FONT}; font-size: 12px; line-height: 1.55; color: ${BRAND_MUTED};">${authoredTextToHtml(branding.footer)}</td>`,
        '</tr>',
        '</table>',
      ].join('')
    : '';

  // Close the card and the outer gutter opened by the header, always.
  return [button, footer, '</td></tr></table></td></tr></table>'].join('');
}

function renderBrandedEmail({
  branding,
  baseTextBody,
  baseHtmlBody,
  emailLayout = 'digest',
}) {
  const textSegments = [
    branding.fromName,
    branding.intro,
    baseTextBody,
    branding.callToAction
      ? `${branding.callToAction.label}: ${branding.callToAction.url}`
      : '',
    branding.footer,
  ].filter((segment) => typeof segment === 'string' && segment.length > 0);

  const withHeader = insertHtmlAfterBodyOpen(
    insertHtmlBeforeHeadClose(baseHtmlBody, BRAND_MOBILE_STYLE),
    buildBrandHeaderHtml(branding, emailLayout)
  );
  const htmlBody = appendHtmlBeforeBodyClose(
    withHeader,
    buildBrandFooterHtml(branding)
  );

  return {
    textBody: textSegments.join('\n\n'),
    htmlBody,
  };
}

function buildEmailBodies(input) {
  const { branding = null, ...baseInput } = input || {};
  const baseBodies = buildBaseEmailBodies(baseInput);
  if (!branding) {
    return baseBodies;
  }

  return renderBrandedEmail({
    branding,
    baseTextBody: baseBodies.textBody,
    baseHtmlBody: baseBodies.htmlBody,
    emailLayout: baseInput.emailLayout,
  });
}

function encodeMimeBodyPart(value, { splitAsciiLines = false } = {}) {
  const content = String(value ?? '');
  if (/^[\x00-\x7f]*$/u.test(content)) {
    return {
      transferEncoding: '7bit',
      bodyParts: splitAsciiLines ? content.split('\n') : [content],
    };
  }

  return {
    transferEncoding: 'base64',
    bodyParts:
      Buffer.from(content, 'utf8').toString('base64').match(/.{1,76}/g) || [],
  };
}

function estimateMimeBodyPartSizeBytes(
  value,
  { splitAsciiLines = false } = {}
) {
  const part = encodeMimeBodyPart(value, { splitAsciiLines });
  return Buffer.byteLength(part.bodyParts.join('\r\n'), 'ascii');
}

function createRawEmail({
  from,
  to,
  subject,
  textBody,
  htmlBody,
  replyTo = null,
  attachments = [],
}) {
  const normalizedAttachments = Array.isArray(attachments) ? attachments : [];

  const mixedBoundary =
    'MixedBoundary_' + Math.random().toString(36).substring(2);
  const altBoundary = 'AltBoundary_' + Math.random().toString(36).substring(2);

  const safeFrom = stripHeaderLineBreaks(from);
  const toHeader = (Array.isArray(to) ? to : [to])
    .map((value) => stripHeaderLineBreaks(value))
    .join(', ');
  const safeSubject = encodeRfc2047Header(subject);
  const safeReplyTo = replyTo ? stripHeaderLineBreaks(replyTo) : null;
  const textPart = encodeMimeBodyPart(textBody, { splitAsciiLines: true });
  const htmlPart = encodeMimeBodyPart(wrapEmailHtml(htmlBody));

  const rawParts = [
    `From: ${safeFrom}`,
    `To: ${toHeader}`,
    `Subject: ${safeSubject}`,
    ...(safeReplyTo ? [`Reply-To: ${safeReplyTo}`] : []),
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    '',
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    '',
    `--${altBoundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    `Content-Transfer-Encoding: ${textPart.transferEncoding}`,
    '',
    ...textPart.bodyParts,
    '',
    `--${altBoundary}`,
    'Content-Type: text/html; charset=UTF-8',
    `Content-Transfer-Encoding: ${htmlPart.transferEncoding}`,
    '',
    ...htmlPart.bodyParts,
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
  buildBaseEmailBodies,
  buildEmailBodies,
  createRawEmail,
  estimateMimeBodyPartSizeBytes,
  wrapEmailHtml,
  appendHtmlBeforeBodyClose,
  insertHtmlAfterBodyOpen,
  renderBrandedEmail,
};
