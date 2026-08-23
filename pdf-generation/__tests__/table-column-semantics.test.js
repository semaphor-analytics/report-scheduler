import { describe, expect, it } from 'vitest';
import { buildPdfTableModel } from '../lib/modes/table-column-semantics.js';

function columnSummary(model) {
  return model.columns.map((column) => ({
    columnId: column.columnId,
    label: column.label,
    isNumeric: column.isNumeric,
    widthPx: column.widthPx,
  }));
}

describe('PDF table model invariants', () => {
  it('applies semantic precedence: authored PDF, metadata, extracted alignment, inference', () => {
    const model = buildPdfTableModel({
      metadata: {
        tableType: 'aggregate',
        columns: [
          { columnId: 'authored_text', isNumeric: true },
          { columnId: 'metadata_text', isNumeric: false },
          { columnId: 'extracted_numeric' },
          { columnId: 'inferred_numeric' },
        ],
      },
      headers: [
        {
          cells: [
            { text: 'Authored text', columnId: 'authored_text', pdfIsNumeric: false },
            { text: 'Metadata text', columnId: 'metadata_text', isNumeric: true },
            { text: 'Extracted numeric', columnId: 'extracted_numeric', isNumeric: true },
            { text: 'Inferred numeric', columnId: 'inferred_numeric' },
          ],
        },
      ],
      rows: [
        {
          cells: [
            { text: '114,129,133' },
            { text: '22540,30045,46' },
            { text: '1,000' },
            { text: '2,000' },
          ],
        },
      ],
    });

    expect(model.columns.map((column) => column.isNumeric)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it('keeps complete group spans from leaking identity, semantics, or width into leaves', () => {
    const model = buildPdfTableModel({
      metadata: { tableType: 'pivot' },
      headers: [
        {
          cells: [
            {
              text: 'Metrics',
              columnId: 'metrics',
              colspan: 2,
              pdfIsNumeric: false,
              measuredWidthPx: 600,
            },
          ],
        },
        {
          cells: [
            { text: 'Amount', columnId: 'amount', isNumeric: true, measuredWidthPx: 120 },
            { text: 'SO #s', columnId: 'so_numbers', isNumeric: false, measuredWidthPx: 180 },
          ],
        },
      ],
      rows: [{ cells: [{ text: '1,000' }, { text: '114,129,133' }] }],
    });

    expect(columnSummary(model)).toEqual([
      expect.objectContaining({
        columnId: 'amount',
        label: 'Amount',
        isNumeric: true,
      }),
      expect.objectContaining({
        columnId: 'so_numbers',
        label: 'SO #s',
        isNumeric: false,
      }),
    ]);
    expect(model.columns[0].widthPx).toBeLessThan(150);
    expect(model.columns[1].widthPx).toBeLessThan(240);
    expect(model.columns[1].widthPx).toBeGreaterThan(model.columns[0].widthPx);
  });

  it('uses a group label only as display fallback for an uncovered child slot', () => {
    const model = buildPdfTableModel({
      metadata: { tableType: 'pivot' },
      headers: [
        {
          cells: [
            {
              text: 'Metrics',
              columnId: 'metrics',
              colspan: 3,
              pdfIsNumeric: true,
              measuredWidthPx: 600,
            },
          ],
        },
        {
          cells: [
            { text: 'Amount', columnId: 'amount', isNumeric: true },
            { text: 'SO #s', columnId: 'so_numbers', isNumeric: false },
          ],
        },
      ],
      rows: [{ cells: [{ text: '1,000' }, { text: '114,129,133' }, { text: 'Open' }] }],
    });

    expect(model.columns[2]).toMatchObject({
      columnId: 'col_3',
      label: 'Metrics',
      isNumeric: false,
    });
    expect(model.columns[2].widthPx).not.toBe(600);
  });

  it('preserves row-spanned leaf semantics for one physical column', () => {
    const model = buildPdfTableModel({
      metadata: { tableType: 'pivot' },
      headers: [
        {
          cells: [
            {
              text: 'Group',
              columnId: 'group',
              rowspan: 2,
              pdfIsNumeric: false,
              measuredWidthPx: 160,
            },
            { text: 'Metrics', colspan: 1 },
          ],
        },
        {
          cells: [{ text: 'Amount', columnId: 'amount', pdfIsNumeric: true }],
        },
      ],
      rows: [{ cells: [{ text: 'ALUMINUM' }, { text: '1,000' }] }],
    });

    expect(model.columns[0]).toMatchObject({ columnId: 'group', isNumeric: false });
    expect(model.columns[1]).toMatchObject({ columnId: 'amount', isNumeric: true });
  });

  it('resolves pivot anchor roles inside the model from normalized structure', () => {
    const model = buildPdfTableModel({
      metadata: { tableType: 'pivot' },
      headers: [
        {
          cells: [
            { text: 'Country', columnId: 'rowLevel0', rowspan: 2, isNumeric: false },
            { text: 'City', columnId: 'rowLevel1', rowspan: 2, isNumeric: false },
            { text: 'Metrics', colspan: 2 },
          ],
        },
        {
          cells: [
            { text: 'Amount', columnId: 'amount', isNumeric: true },
            { text: 'Count', columnId: 'count', isNumeric: true },
          ],
        },
      ],
      rows: [
        {
          cells: [
            { text: 'US', columnId: 'rowLevel0', isHeader: true },
            { text: 'Chicago', columnId: 'rowLevel1', isHeader: true },
            { text: '1,000' },
            { text: '5' },
          ],
        },
      ],
    });

    expect(model.isPivotTable).toBe(true);
    expect(model.pivotAnchorCount).toBe(2);
  });

  it('projects identical resolved semantics from structured and DOM-shaped inputs', () => {
    const structured = buildPdfTableModel({
      metadata: { tableType: 'aggregate' },
      headers: [
        {
          cells: [
            { text: 'SO #s', columnId: 'so_numbers', pdfIsNumeric: false },
            { text: 'Amount', columnId: 'amount', pdfIsNumeric: true },
          ],
        },
      ],
      rows: [{ cells: [{ text: '114,129,133' }, { text: '1,000' }] }],
    });
    const domExtracted = buildPdfTableModel({
      metadata: { tableType: 'aggregate' },
      headers: [
        {
          cells: [
            { text: 'SO #s', columnId: 'so_numbers', isNumeric: false },
            { text: 'Amount', columnId: 'amount', isNumeric: true },
          ],
        },
      ],
      rows: [{ cells: [{ text: '114,129,133' }, { text: '1,000' }] }],
    });

    expect(columnSummary(structured)).toEqual(columnSummary(domExtracted));
    expect(
      structured.project().rows[0].cells.map((cell) => ({
        isNumeric: cell.isNumeric,
        className: cell.className,
      })),
    ).toEqual(
      domExtracted.project().rows[0].cells.map((cell) => ({
        isNumeric: cell.isNumeric,
        className: cell.className,
      })),
    );
  });
});
