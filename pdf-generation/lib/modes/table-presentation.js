export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function buildTableReportHeaderHtml(reportTitle, filterLine = '') {
  const filterHtml = filterLine
    ? `<div class="metadata-line"><span class="metadata-label">Filters:</span> ${escapeHtml(filterLine)}</div>`
    : '';

  return `
    <div class="report-header">
      <div class="header-top">
        <div class="report-title">${escapeHtml(reportTitle)}</div>
        ${filterHtml}
      </div>
    </div>
  `;
}

export function getPaginationRowClassName(row = {}) {
  const classNames = [];
  if (row.type === 'subtotal') {
    classNames.push('subtotal');
  }
  return classNames.join(' ');
}

export const TABLE_REPORT_HEADER_CSS = `
  .report-header {
    margin-bottom: 10px;
    break-inside: auto;
    page-break-inside: auto;
  }

  .header-top {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }

  .report-title {
    font-size: 18pt;
    font-weight: 700;
    color: #111;
  }

  .metadata-line {
    width: 100%;
    margin-top: 6px;
    font-size: 9pt;
    line-height: 1.35;
    color: #555;
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: normal;
  }

  .metadata-label {
    color: #333;
    font-weight: 600;
  }
`;

export const BOUNDED_SUBTOTAL_PRINT_CSS = `
  thead {
    display: table-header-group;
  }

  tr {
    break-inside: auto;
    page-break-inside: auto;
  }

  tbody.group.subtotal-tail {
    break-inside: avoid-page;
    page-break-inside: avoid;
  }

  tbody.group.subtotal-tail:first-of-type {
    break-inside: auto;
    page-break-inside: auto;
  }

  tr.subtotal,
  tr.grand-total {
    break-inside: avoid-page;
    page-break-inside: avoid;
  }
`;
