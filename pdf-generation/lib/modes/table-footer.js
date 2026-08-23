function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const PAGE_WIDTH_MM = {
  Letter: 215.9,
  Legal: 215.9,
  Tabloid: 279.4,
  Ledger: 431.8,
  A0: 841,
  A1: 594,
  A2: 420,
  A3: 297,
  A4: 210,
  A5: 148,
  A6: 105,
};

const PAGE_HEIGHT_MM = {
  Letter: 279.4,
  Legal: 355.6,
  Tabloid: 431.8,
  Ledger: 279.4,
  A0: 1189,
  A1: 841,
  A2: 594,
  A3: 420,
  A4: 297,
  A5: 210,
  A6: 148,
};

function isNarrowFooter(pageSize, orientation) {
  const normalizedSize = PAGE_WIDTH_MM[pageSize] ? pageSize : 'Letter';
  const isLandscape = String(orientation || 'portrait').toLowerCase() === 'landscape';
  const widthMm = isLandscape
    ? PAGE_HEIGHT_MM[normalizedSize]
    : PAGE_WIDTH_MM[normalizedSize];
  return widthMm < PAGE_WIDTH_MM.A5;
}

export function buildTableFooterTemplate(
  options = {},
  defaultReportTitle = 'Report',
) {
  const now = new Date();
  const timezone = options.timezone || 'UTC';
  const rawReportTitle = String(options.reportTitle || defaultReportTitle);
  const reportTitle = escapeHtml(rawReportTitle);
  const narrow = isNarrowFooter(options.pageSize, options.orientation);
  const currentDate = now.toLocaleDateString('en-US', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const currentTime = now.toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const timeZoneAbbr = now
    .toLocaleTimeString('en-US', {
      timeZone: timezone,
      timeZoneName: 'short',
    })
    .split(' ')
    .pop();

  const containerLayout = narrow
    ? `
      position:relative;
      height:18pt;
      font-size:7pt;
    `
    : `
      position:relative;
      height:10pt;
      font-size:8pt;
    `;
  const titlePosition = narrow
    ? 'left:5mm;right:30mm;top:0;'
    : 'left:10mm;right:115mm;top:0;';
  const generatedPosition = narrow
    ? 'left:5mm;right:5mm;top:9pt;'
    : 'right:38mm;width:72mm;top:0;';
  const paginationPosition = narrow
    ? 'right:5mm;width:23mm;top:0;'
    : 'right:10mm;width:25mm;top:0;';

  return `
    <div data-footer-layout="${narrow ? 'narrow' : 'standard'}" style="
      box-sizing:border-box;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
      color:#666;
      width:100%;
      ${containerLayout}
    ">
      <span data-footer-region="title" style="
        position:absolute;
        ${titlePosition}
        min-width:0;
        overflow:hidden;
        text-overflow:ellipsis;
        white-space:nowrap;
        text-align:left;
      ">${reportTitle}</span>
      <span data-footer-region="generated" style="
        position:absolute;
        ${generatedPosition}
        white-space:nowrap;
        text-align:${narrow ? 'center' : 'right'};
      ">Generated ${currentDate}, ${currentTime} ${timeZoneAbbr || ''}</span>
      <span data-footer-region="pagination" style="
        position:absolute;
        ${paginationPosition}
        white-space:nowrap;
        text-align:right;
      ">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
    </div>
  `;
}
