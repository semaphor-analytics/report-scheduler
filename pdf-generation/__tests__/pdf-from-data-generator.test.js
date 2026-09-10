import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  applyPdfMetadataMock,
  closeBrowserMock,
  encryptPdfBufferMock,
  launchBrowserMock,
  newPageMock,
  pagePdfMock,
  renderDataTableHtmlMock,
  setContentMock,
} = vi.hoisted(() => {
  const applyPdfMetadataMock = vi.fn(async pdfBuffer => pdfBuffer);
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
    applyPdfMetadataMock,
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
  applyPdfMetadata: applyPdfMetadataMock,
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
const { paginateTableData } = await import('../lib/modes/pivot-table-paginator.js');
const { renderPivotTableHtml, getPdfOptions: getPivotPdfOptions } = await import('../lib/modes/pivot-table.js');

describe('pdf-from-data-generator', () => {
  beforeEach(() => {
    applyPdfMetadataMock.mockClear();
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

    expect(applyPdfMetadataMock).toHaveBeenCalledWith(expect.any(Buffer), {
      title: 'Fast Path Report',
    });
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

  it('validates generated pages after metadata and before encryption', async () => {
    const validatePreparedPdf = vi.fn(async () => {});
    const payload = {
      cardType: 'table',
      password: 'secret',
      reportTitle: 'Lifecycle report',
      tableStructure: {
        headers: ['Name'],
        rows: [['Revenue']],
        metadata: {},
      },
    };

    await generatePdfFromData(payload, { validatePreparedPdf });

    expect(applyPdfMetadataMock).toHaveBeenCalledBefore(validatePreparedPdf);
    expect(validatePreparedPdf).toHaveBeenCalledBefore(encryptPdfBufferMock);
  });

  it('routes Matrix through the existing pivot paginator and horizontal banding', async () => {
    const pages = [{ rows: [], metadata: {} }];
    paginateTableData.mockReturnValue(pages);
    renderPivotTableHtml.mockReturnValue({ html: '<html>Matrix</html>', layoutApplied: { effectivePageSize: 'Letter', effectiveOrientation: 'landscape' } });
    getPivotPdfOptions.mockReturnValue({ format: 'Letter' });
    const tableStructure = { headers: [{ cells: [] }], rows: [{ cells: [] }], metadata: { rowLevels: 2 } };
    const result = await generatePdfFromData({ cardType: 'matrixTable', tableStructure, wideTableStrategy: 'horizontal_paginate' });
    expect(paginateTableData).toHaveBeenCalledWith(expect.objectContaining(tableStructure), expect.any(Object));
    expect(renderPivotTableHtml).toHaveBeenCalledWith(pages, expect.objectContaining({ wideTableStrategy: 'horizontal_paginate' }));
    expect(result.layoutApplied.effectiveOrientation).toBe('landscape');
  });

  it('does not start an aborted render and closes a browser on cancellation during rendering', async () => {
    const payload = { cardType: 'table', tableStructure: { headers: [], rows: [] } };
    const controller = new AbortController();
    controller.abort(new Error('Deadline'));
    await expect(generatePdfFromData(payload, { signal: controller.signal })).rejects.toThrow('Deadline');
    expect(launchBrowserMock).not.toHaveBeenCalled();
    const active = new AbortController();
    const close = vi.fn(async () => {});
    launchBrowserMock.mockResolvedValueOnce({ newPage: newPageMock, close });
    pagePdfMock.mockImplementationOnce(async () => { active.abort(new Error('Cancelled')); return Buffer.from('partial'); });
    await expect(generatePdfFromData(payload, { signal: active.signal })).rejects.toThrow('Cancelled');
    expect(close).toHaveBeenCalledTimes(1);
    expect(applyPdfMetadataMock).not.toHaveBeenCalled();
  });
});
