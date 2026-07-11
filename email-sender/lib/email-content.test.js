const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildEmailBodies,
  createRawEmail,
  wrapEmailHtml,
} = require('./email-content');

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
