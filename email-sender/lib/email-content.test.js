const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildEmailBodies,
  createRawEmail,
  insertHtmlAfterBodyOpen,
  renderBrandedEmail,
  wrapEmailHtml,
} = require('./email-content');
const unbrandedBaseline = require('../test-fixtures/unbranded-bodies.json');
const unbrandedMimeBaseline = require('../test-fixtures/unbranded-mime.json');
const brandedPlainSample = require('../test-fixtures/branded-plain-sample.json');

const branding = {
  version: 1,
  fromName: 'Respark Reports',
  replyTo: 'reply@respark.com',
  bcc: 'archive@respark.com',
  logoUrl: 'https://cdn.respark.com/logo.png',
  accentColor: '#1a6ef4',
  intro: 'Hello team,\nYour report is ready.',
  footer: 'Prepared for Respark.',
  callToAction: {
    url: 'https://app.respark.com/reports',
    label: 'Open app',
  },
};

test('raw SES HTML wrapper uses a responsive cardless email shell', () => {
  const raw = createRawEmail({
    from: 'Reports <reports@example.com>',
    to: ['user@example.com'],
    subject: 'Dashboard Email Report',
    textBody: 'Hi team,',
    htmlBody:
      '<div style="font-size: 14px; white-space: pre-wrap;">Hi team,<br><br>Sharing this dashboard.</div>',
    attachments: [],
  }).toString('utf8');

  assert.match(
    raw,
    /<meta name="viewport" content="width=device-width, initial-scale=1\.0">/
  );
  assert.match(
    raw,
    /class="email-gutter" align="center" style="padding: 0;"/
  );
  assert.match(raw, /background: #ffffff/);
  // Cardless layout: max-width caps line length but no card border or radius.
  assert.match(raw, /max-width: 680px/);
  assert.doesNotMatch(raw, /border:\s*1px solid #e5e7eb/);
  assert.doesNotMatch(raw, /border-radius:\s*8px/);
  assert.match(raw, /class="email-content" style="padding: 28px 32px;/);
  // Font-family inner quotes must be HTML entities — raw double quotes inside
  // a double-quoted style attribute corrupt the attribute and Gmail drops the
  // entire style (which is what wiped out padding in Gmail web).
  assert.match(raw, /font-family: &quot;Open Sans&quot;,/);
  assert.doesNotMatch(raw, /font-family: "Open Sans"/);
  assert.match(raw, /padding: 22px 18px !important/);
  // Mobile readability: descendant selectors must override the inline 16px
  // body size that markdownToEmailHtml emits, otherwise iPhone Mail renders
  // body text at the inline size, not the wrapper's mobile-bumped size.
  assert.match(raw, /\.email-content \{ padding: 22px 18px !important; font-size: 18px !important;/);
  assert.match(raw, /\.email-content p \{ font-size: 18px !important;/);
  assert.match(raw, /\.email-content li \{ font-size: 18px !important;/);
  assert.match(raw, /\.email-content td \{ font-size: 18px !important;/);
  // Wide briefing tables would otherwise force iOS Mail to scale the entire
  // document down. The mobile media query must hide low-priority cells and
  // tighten the scroll-wrapper margin.
  assert.match(raw, /\.briefing-col-hide-mobile \{ display: none !important; \}/);
  assert.match(raw, /\.briefing-table-scroll \{ margin: 14px 0 !important; \}/);
  assert.doesNotMatch(raw, /padding-left:\s*25px/);
});

test('buildEmailBodies escapes custom plain-text messages before rendering HTML', () => {
  const bodies = buildEmailBodies({
    emailMessage: 'Hi <team>,\nUse "Dashboard" & reply.',
  });

  assert.match(
    bodies.htmlBody,
    /Hi &lt;team&gt;,<br>Use &quot;Dashboard&quot; &amp; reply\./
  );
  assert.doesNotMatch(bodies.htmlBody, /Hi <team>/);
  assert.match(bodies.htmlBody, /max-width: 680px/);
});

test('plain report layout starts from the natural left edge', () => {
  const bodies = buildEmailBodies({
    emailMessage: 'Attached is the latest Admin Dashboard report.',
    emailLayout: 'plain',
  });

  assert.match(
    bodies.htmlBody,
    /class="email-gutter" align="left" style="padding: 0;"/
  );
  assert.doesNotMatch(bodies.htmlBody, /max-width: 680px/);
});

test('buildEmailBodies preserves trusted briefing HTML documents with text fallback', () => {
  const htmlDocument =
    '<!doctype html><html><body><main><h1>Weekly Brief</h1></main></body></html>';
  const bodies = buildEmailBodies({
    emailMessage: '# Weekly Brief\n\nRevenue increased.',
    emailTextMessage: 'Weekly Brief\n\nRevenue increased.',
    emailHtmlMessage: htmlDocument,
  });

  assert.equal(bodies.textBody, 'Weekly Brief\n\nRevenue increased.');
  assert.equal(bodies.htmlBody, htmlDocument);
});

test('buildEmailBodies injects download links inside trusted briefing HTML documents', () => {
  const htmlDocument =
    '<!doctype html><html><body><main><h1>Weekly Brief</h1></main></body></html>';
  const bodies = buildEmailBodies({
    emailTextMessage: 'Weekly Brief',
    emailHtmlMessage: htmlDocument,
    downloadLinks: [{ name: 'Dashboard.pdf', url: 'https://example.test/report.pdf' }],
  });

  assert.match(bodies.htmlBody, /Dashboard\.pdf/);
  assert.match(bodies.htmlBody, /<\/div><\/body><\/html>$/);
  assert.doesNotMatch(bodies.htmlBody, /<\/html><div/);
});

test('wrapEmailHtml leaves complete HTML documents unchanged', () => {
  const fullDocument = '<html><body><p>Already wrapped</p></body></html>';

  assert.equal(wrapEmailHtml(fullDocument), fullDocument);
});

test('unbranded body outputs remain byte-identical to the Phase 2 baseline', () => {
  const actual = {
    plain: buildEmailBodies({
      emailMessage: 'Hi <team>,\nUse "Dashboard" & reply.',
      emailLayout: 'plain',
    }),
    digest: buildEmailBodies({
      emailMessage: 'Weekly report',
      emailLayout: 'digest',
    }),
    fullDocument: buildEmailBodies({
      emailTextMessage: 'Weekly Brief',
      emailHtmlMessage:
        '<!doctype html><html><body><main><h1>Weekly Brief</h1></main></body></html>',
      downloadLinks: [
        {
          name: 'Dashboard.pdf',
          url: 'https://example.test/report.pdf',
        },
      ],
    }),
    defaults: buildEmailBodies({
      dashboardLink: 'https://app.semaphor.test/dashboard/123',
      companyName: 'Acme Analytics',
      supportEmail: 'support@acme.com',
    }),
  };

  assert.deepEqual(actual, unbrandedBaseline);
});

test('unbranded MIME remains byte-identical to the pre-Phase-2 baseline', () => {
  const randomValues = [0.123456789, 0.987654321];
  let randomIndex = 0;
  const originalRandom = Math.random;
  Math.random = () => randomValues[randomIndex++];

  try {
    const raw = createRawEmail({
      from: 'Acme Analytics <reports@acme.com>',
      to: ['a@example.com', 'b@example.com'],
      subject: 'Weekly report',
      textBody:
        'Author message\n\nDownload links:\nDashboard: https://example.com/report',
      htmlBody:
        '<p>Author message</p><p><a href="https://example.com/report">Download Dashboard</a></p>',
      attachments: [
        {
          name: 'Revenue Report.pdf',
          contentType: 'application/pdf',
          fileBuffer: Buffer.from('phase-2-baseline-pdf'),
        },
      ],
    });

    assert.equal(raw.toString('base64'), unbrandedMimeBaseline.rawBase64);
  } finally {
    Math.random = originalRandom;
  }
});

test('branded rendering surrounds the canonical base body in the specified order', () => {
  const bodies = buildEmailBodies({
    branding,
    emailMessage: 'Author message',
    emailLayout: 'digest',
    downloadLinks: [
      { name: 'Report.pdf', url: 'https://example.test/report.pdf' },
    ],
  });

  assert.equal(
    bodies.textBody,
    [
      'Respark Reports',
      'Hello team,\nYour report is ready.',
      'Author message\nDownload links:\n- Report.pdf: https://example.test/report.pdf',
      'Open app: https://app.respark.com/reports',
      'Prepared for Respark.',
    ].join('\n\n')
  );

  const headerIndex = bodies.htmlBody.indexOf('Respark Reports');
  const introIndex = bodies.htmlBody.indexOf('Hello team,<br>Your report is ready.');
  const authorIndex = bodies.htmlBody.indexOf('Author message');
  const linkIndex = bodies.htmlBody.indexOf('Report.pdf');
  const buttonIndex = bodies.htmlBody.indexOf('Open app');
  const footerIndex = bodies.htmlBody.indexOf('Prepared for Respark.');
  assert.ok(headerIndex < introIndex);
  assert.ok(introIndex < authorIndex);
  assert.ok(authorIndex < linkIndex);
  assert.ok(linkIndex < buttonIndex);
  assert.ok(buttonIndex < footerIndex);
  assert.equal(bodies.htmlBody.match(/Report\.pdf/gu)?.length, 1);
});

test('branded rendering escapes customer-authored values and attributes', () => {
  const bodies = buildEmailBodies({
    branding: {
      ...branding,
      fromName: 'Respark & Partners',
      intro: '<strong>Hello</strong>',
      footer: 'Questions? <reply>',
      callToAction: {
        url: 'https://app.respark.com/reports?team=a&view=1',
        label: 'Open <reports>',
      },
    },
    emailMessage: 'Author message',
  });

  assert.match(bodies.htmlBody, /Respark &amp; Partners/u);
  assert.match(bodies.htmlBody, /&lt;strong&gt;Hello&lt;\/strong&gt;/u);
  assert.match(bodies.htmlBody, /Open &lt;reports&gt;/u);
  assert.match(bodies.htmlBody, /team=a&amp;view=1/u);
  assert.doesNotMatch(bodies.htmlBody, /<strong>Hello<\/strong>/u);
});

test('branded renderer handles a full HTML document without a body tag', () => {
  const rendered = renderBrandedEmail({
    branding,
    baseTextBody: 'Author message',
    baseHtmlBody:
      '<!doctype html><html><head><title>Report</title></head><main>Author message</main></html>',
    emailLayout: 'plain',
  });

  assert.match(rendered.htmlBody, /<style>@media[^<]*<\/style><\/head><table role="presentation"/u);
  assert.match(
    rendered.htmlBody,
    /Prepared for Respark\.<\/td><\/tr><\/table><\/td><\/tr><\/table><\/td><\/tr><\/table><\/html>$/u
  );
});

test('empty optional brand sections do not add empty content blocks', () => {
  const rendered = renderBrandedEmail({
    branding: {
      version: 1,
      fromName: 'Respark Reports',
      accentColor: '#1a6ef4',
    },
    baseTextBody: 'Author message',
    baseHtmlBody: '<html><body><p>Author message</p></body></html>',
  });

  assert.equal(rendered.textBody, 'Respark Reports\n\nAuthor message');
  assert.doesNotMatch(rendered.htmlBody, /href=/u);
});

test('HTML insertion falls back to the opening html tag when head and body are absent', () => {
  assert.equal(
    insertHtmlAfterBodyOpen('<html><main>Body</main></html>', '<header>Brand</header>'),
    '<html><header>Brand</header><main>Body</main></html>'
  );
});

test('raw MIME includes Reply-To, encodes Unicode headers, and never emits Bcc', () => {
  const raw = createRawEmail({
    from: '=?UTF-8?B?w4lxdWlwZSBSZXNwYXJr?= <reports@example.com>',
    to: ['user@example.com'],
    subject: 'Résumé hebdomadaire',
    replyTo: 'reply@example.com',
    textBody: 'Report',
    htmlBody: '<p>Report</p>',
  }).toString('utf8');

  assert.match(raw, /Reply-To: reply@example\.com\r\n/u);
  assert.match(raw, /Subject: =\?UTF-8\?B\?.+\?=\r\n/u);
  assert.doesNotMatch(raw, /^Bcc:/imu);
});

test('raw MIME base64-encodes Unicode text and HTML body parts', () => {
  const textBody = 'Équipe Respark\n\nRésumé prêt.';
  const authoredHtml = '<p>Résumé prêt — ouvrir l’application.</p>';
  const expectedHtmlBody = wrapEmailHtml(authoredHtml);
  const raw = createRawEmail({
    from: 'Reports <reports@example.com>',
    to: ['user@example.com'],
    subject: 'Weekly report',
    textBody,
    htmlBody: authoredHtml,
  }).toString('utf8');

  function decodeBodyPart(contentType) {
    const marker = [
      `Content-Type: ${contentType}; charset=UTF-8`,
      'Content-Transfer-Encoding: base64',
      '',
    ].join('\r\n');
    const bodyStart = raw.indexOf(marker);
    assert.notEqual(bodyStart, -1);
    const encodedStart = bodyStart + marker.length;
    const encodedEnd = raw.indexOf('\r\n\r\n--', encodedStart);
    assert.notEqual(encodedEnd, -1);
    const encodedLines = raw.slice(encodedStart, encodedEnd).split('\r\n');
    assert.ok(encodedLines.every((line) => line.length <= 76));
    return Buffer.from(encodedLines.join(''), 'base64').toString('utf8');
  }

  assert.equal(decodeBodyPart('text/plain'), textBody);
  assert.equal(decodeBodyPart('text/html'), expectedHtmlBody);
});

// The app keeps a TypeScript copy of the branded renderer for the Brand Studio
// preview and asserts against this same fixture. If this test fails after an
// intentional template change, regenerate the fixture and mirror the change in
// semaphor-app/src/lib/email-branding/email-template.ts.
test('branded plain sample matches the golden fixture shared with the app', () => {
  const bodies = buildEmailBodies(brandedPlainSample.input);
  assert.equal(bodies.htmlBody, brandedPlainSample.htmlBody);
  assert.equal(bodies.textBody, brandedPlainSample.textBody);
});
