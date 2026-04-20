import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  closeBrowserMock,
  encryptPdfBufferMock,
  launchBrowserMock,
  newPageMock,
  pagePdfMock,
  renderDataTableHtmlMock,
  setContentMock,
} = vi.hoisted(() => {
  const setContentMock = vi.fn();
  const pagePdfMock = vi.fn();
  const newPageMock = vi.fn(async () => ({
    setContent: setContentMock,
    pdf: pagePdfMock,
  }));
  const launchBrowserMock = vi.fn(async () => ({
    newPage: newPageMock,
  }));
  const closeBrowserMock = vi.fn(async () => {});
  const encryptPdfBufferMock = vi.fn(async () => Buffer.from('encrypted-pdf'));
  const renderDataTableHtmlMock = vi.fn(() => ({
    html: '<html><body>Table</body></html>',
    layoutApplied: null,
  }));

  return {
    closeBrowserMock,
    encryptPdfBufferMock,
    launchBrowserMock,
    newPageMock,
    pagePdfMock,
    renderDataTableHtmlMock,
    setContentMock,
  };
});

vi.mock('../lib/browser.js', () => ({
  closeBrowser: closeBrowserMock,
  launchBrowser: launchBrowserMock,
}));

vi.mock('../pdf-encrypt.js', () => ({
  encryptPdfBuffer: encryptPdfBufferMock,
}));

vi.mock('../lib/pdf-metadata.js', () => ({
  applyPdfMetadata: vi.fn(async pdfBuffer => pdfBuffer),
}));

vi.mock('../lib/modes/data-table-paginator.js', () => ({
  paginateDataTable: vi.fn(() => [{ rows: [], metadata: {} }]),
}));

vi.mock('../lib/modes/data-table.js', () => ({
  getPdfOptions: vi.fn(() => ({ format: 'Letter' })),
  renderDataTableHtml: renderDataTableHtmlMock,
}));

vi.mock('../lib/modes/aggregate-table-paginator.js', () => ({
  paginateAggregateTable: vi.fn(),
}));

vi.mock('../lib/modes/aggregate-table.js', () => ({
  getPdfOptions: vi.fn(),
  renderAggregateTableHtml: vi.fn(),
}));

vi.mock('../lib/modes/pivot-table-paginator.js', () => ({
  paginateTableData: vi.fn(),
}));

vi.mock('../lib/modes/pivot-table.js', () => ({
  getPdfOptions: vi.fn(),
  renderPivotTableHtml: vi.fn(),
}));

vi.mock('../lib/watermark-utils.js', () => ({
  getHeaderLogoHtml: vi.fn(() => ''),
  getWatermarkHtml: vi.fn(() => ''),
}));

const { generatePdfFromData } = await import('../lib/pdf-from-data-generator.js');

describe('pdf-from-data-generator', () => {
  beforeEach(() => {
    closeBrowserMock.mockClear();
    encryptPdfBufferMock.mockClear();
    launchBrowserMock.mockClear();
    newPageMock.mockClear();
    pagePdfMock.mockReset();
    pagePdfMock.mockResolvedValue(Buffer.from('plain-pdf-buffer-contents'));
    renderDataTableHtmlMock.mockClear();
    setContentMock.mockClear();
  });

  it('passes report metadata into encrypted fast-path exports', async () => {
    const payload = {
      cardType: 'table',
      password: 'secret',
      reportTitle: 'Fast Path Report',
      tableStructure: {
        headers: ['Name'],
        rows: [['Revenue']],
        metadata: {},
      },
    };

    await generatePdfFromData(payload, {});

    expect(encryptPdfBufferMock).toHaveBeenCalledTimes(1);
    expect(encryptPdfBufferMock).toHaveBeenCalledWith(
      expect.any(Buffer),
      'secret',
      {
        metadata: {
          title: 'Fast Path Report',
        },
      }
    );
  });
});
