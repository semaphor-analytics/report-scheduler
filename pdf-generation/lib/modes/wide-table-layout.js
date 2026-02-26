import { normalizePageSize } from '../page-size-utils.js';

const DPI = 96;
const MM_TO_PX = DPI / 25.4;

const PAGE_SIZES_PX = {
  Letter: { width: 8.5 * DPI, height: 11 * DPI },
  Legal: { width: 8.5 * DPI, height: 14 * DPI },
  Tabloid: { width: 11 * DPI, height: 17 * DPI },
  Ledger: { width: 17 * DPI, height: 11 * DPI },
  A0: { width: (841 / 25.4) * DPI, height: (1189 / 25.4) * DPI },
  A1: { width: (594 / 25.4) * DPI, height: (841 / 25.4) * DPI },
  A2: { width: (420 / 25.4) * DPI, height: (594 / 25.4) * DPI },
  A3: { width: (297 / 25.4) * DPI, height: (420 / 25.4) * DPI },
  A4: { width: (210 / 25.4) * DPI, height: (297 / 25.4) * DPI },
  A5: { width: (148 / 25.4) * DPI, height: (210 / 25.4) * DPI },
  A6: { width: (105 / 25.4) * DPI, height: (148 / 25.4) * DPI },
};

// Ordered by printable landscape width (narrow -> wide)
const WIDER_PAGE_ORDER = ['Letter', 'Legal', 'A3', 'Tabloid'];

const MIN_WIDTHS_PX = {
  rowNumber: 44,
  boolean: 56,
  numeric: 96,
  datetime: 84,
  id: 96,
  text: 120,
};

const NUMERIC_WIDTH_ESTIMATE = {
  charPx: 8,
  paddingPx: 22,
  maxChars: 24,
};

function normalizeCellText(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function hasMeaningfulText(value) {
  return normalizeCellText(value).trim().length > 0;
}

function isMissingLike(value) {
  const normalized = normalizeCellText(value).trim().toLowerCase();
  if (!normalized) return true;
  return ['-', '—', '–', 'n/a', 'na', 'null', 'none'].includes(normalized);
}

function normalizeOrientation(orientation) {
  return String(orientation || 'portrait').toLowerCase() === 'landscape'
    ? 'landscape'
    : 'portrait';
}

function getPageDimensions(pageSize, orientation) {
  const normalizedSize = normalizePageSize(pageSize || 'Letter');
  const size = PAGE_SIZES_PX[normalizedSize] || PAGE_SIZES_PX.Letter;
  const normalizedOrientation = normalizeOrientation(orientation);

  if (normalizedOrientation === 'landscape') {
    return {
      pageSize: normalizedSize,
      orientation: normalizedOrientation,
      width: size.height,
      height: size.width,
    };
  }

  return {
    pageSize: normalizedSize,
    orientation: normalizedOrientation,
    width: size.width,
    height: size.height,
  };
}

function getPrintableWidthPx(pageSize, orientation) {
  const dims = getPageDimensions(pageSize, orientation);
  const horizontalPdfMargins = (10 + 10) * MM_TO_PX;
  const horizontalBodyPadding = 40;
  const safety = 8;
  return Math.max(200, dims.width - horizontalPdfMargins - horizontalBodyPadding - safety);
}

function expandCells(cells = []) {
  const expanded = [];
  cells.forEach((cell) => {
    const span = Math.max(1, Number(cell.colspan || 1));
    const base = {
      text: normalizeCellText(cell.text),
      colspan: 1,
      rowspan: 1,
      className: cell.className || '',
      columnId: cell.columnId || null,
      isHeader: Boolean(cell.isHeader),
      isNumeric: Boolean(cell.isNumeric),
      measuredWidthPx: Number(cell.measuredWidthPx) || null,
    };
    expanded.push(base);
    for (let i = 1; i < span; i += 1) {
      expanded.push({
        text: '',
        colspan: 1,
        rowspan: 1,
        className: cell.className || '',
        columnId: null,
        isHeader: Boolean(cell.isHeader),
        isNumeric: Boolean(cell.isNumeric),
        measuredWidthPx: null,
      });
    }
  });
  return expanded;
}

function normalizeRowCells(cells = [], leafCount) {
  const normalized = [];
  let cursor = 0;

  cells.forEach((cell) => {
    const span = Math.max(1, Number(cell.colspan || 1));
    const base = {
      text: normalizeCellText(cell.text),
      colspan: 1,
      rowspan: 1,
      className: cell.className || '',
      columnId: cell.columnId || null,
      isHeader: Boolean(cell.isHeader),
      isNumeric: Boolean(cell.isNumeric),
      measuredWidthPx: Number(cell.measuredWidthPx) || null,
    };
    if (cursor < leafCount) {
      normalized[cursor] = base;
    }
    for (let i = 1; i < span; i += 1) {
      if (cursor + i >= leafCount) break;
      normalized[cursor + i] = {
        text: '',
        colspan: 1,
        rowspan: 1,
        className: cell.className || '',
        columnId: null,
        isHeader: Boolean(cell.isHeader),
        isNumeric: Boolean(cell.isNumeric),
        measuredWidthPx: null,
      };
    }
    cursor += span;
  });

  while (normalized.length < leafCount) {
    normalized.push({
      text: '',
      colspan: 1,
      rowspan: 1,
      className: '',
      columnId: null,
      isHeader: false,
      isNumeric: false,
      measuredWidthPx: null,
    });
  }

  return normalized.slice(0, leafCount);
}

function createEmptyCell() {
  return {
    text: '',
    colspan: 1,
    rowspan: 1,
    className: '',
    columnId: null,
    isHeader: false,
    isNumeric: false,
    measuredWidthPx: null,
  };
}

function normalizeRowsWithRowspan(rows = [], leafCount) {
  const carryByColumn = Array.from({ length: leafCount }, () => 0);

  return rows.map((row) => {
    const normalized = Array.from({ length: leafCount }, () => null);
    const rowCells = row?.cells || [];
    let cursor = 0;

    const fillCarriedSlots = () => {
      while (cursor < leafCount && carryByColumn[cursor] > 0) {
        normalized[cursor] = createEmptyCell();
        carryByColumn[cursor] -= 1;
        cursor += 1;
      }
    };

    fillCarriedSlots();

    rowCells.forEach((cell) => {
      fillCarriedSlots();

      if (cursor >= leafCount) {
        return;
      }

      const colspan = Math.max(1, Number(cell.colspan || 1));
      const rowspan = Math.max(1, Number(cell.rowspan || 1));

      for (let spanOffset = 0; spanOffset < colspan; spanOffset += 1) {
        const targetIndex = cursor + spanOffset;
        if (targetIndex >= leafCount) {
          break;
        }

        if (spanOffset === 0) {
          normalized[targetIndex] = {
            text: normalizeCellText(cell.text),
            colspan: 1,
            rowspan: 1,
            className: cell.className || '',
            columnId: cell.columnId || null,
            isHeader: Boolean(cell.isHeader),
            isNumeric: Boolean(cell.isNumeric),
            measuredWidthPx: Number(cell.measuredWidthPx) || null,
          };
        } else {
          normalized[targetIndex] = {
            text: '',
            colspan: 1,
            rowspan: 1,
            className: cell.className || '',
            columnId: null,
            isHeader: Boolean(cell.isHeader),
            isNumeric: Boolean(cell.isNumeric),
            measuredWidthPx: null,
          };
        }

        if (rowspan > 1) {
          carryByColumn[targetIndex] = Math.max(carryByColumn[targetIndex], rowspan - 1);
        }
      }

      cursor += colspan;
    });

    while (cursor < leafCount) {
      if (carryByColumn[cursor] > 0) {
        normalized[cursor] = createEmptyCell();
        carryByColumn[cursor] -= 1;
      } else if (!normalized[cursor]) {
        normalized[cursor] = createEmptyCell();
      }
      cursor += 1;
    }

    for (let i = 0; i < leafCount; i += 1) {
      if (!normalized[i]) {
        normalized[i] = createEmptyCell();
      }
    }

    return normalized;
  });
}

function isBooleanLike(value) {
  const normalized = normalizeCellText(value).trim().toLowerCase();
  return ['true', 'false', 'yes', 'no', 'y', 'n', 'on', 'off'].includes(normalized);
}

function isDateLike(value) {
  const text = normalizeCellText(value).trim();
  if (!text) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return true;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(text)) return true;
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(text)) return true;
  return false;
}

function isIdLike(value) {
  const text = normalizeCellText(value).trim();
  if (!text) return false;
  if (text.includes(' ')) return false;
  return /^[a-z0-9_.:-]{8,}$/i.test(text);
}

function isNumericLike(value) {
  if (typeof value === 'number') return true;
  const normalized = normalizeCellText(value)
    .trim()
    .replace(/^\((.*)\)$/, '-$1')
    .replace(/[$,%\s]/g, '')
    .replace(/,/g, '');
  if (!normalized) return false;
  return /^-?\d+(\.\d+)?$/.test(normalized);
}

function getColumnMeta(columnsMeta, columnId, index) {
  if (!Array.isArray(columnsMeta)) return null;
  const exactMatch = columnsMeta.find((col) => col?.columnId && col.columnId === columnId);
  if (exactMatch) return exactMatch;
  const indexed = columnsMeta[index];
  if (indexed) return indexed;
  return null;
}

function getColumnMeasuredWidth(columnsMeta, columnId, index) {
  const columnMeta = getColumnMeta(columnsMeta, columnId, index);
  if (!columnMeta) return null;
  if (Number.isFinite(columnMeta.measuredWidthPx)) {
    return Number(columnMeta.measuredWidthPx);
  }
  return null;
}

function inferColumnType(headerCell, sampleValues) {
  if (headerCell?.isNumeric) return 'numeric';

  const nonEmpty = sampleValues.filter((value) => !isMissingLike(value));
  if (nonEmpty.length === 0) return 'text';

  const numericRatio =
    nonEmpty.filter((value) => isNumericLike(value)).length / nonEmpty.length;
  if (numericRatio >= 0.8) return 'numeric';

  const booleanRatio =
    nonEmpty.filter((value) => isBooleanLike(value)).length / nonEmpty.length;
  if (booleanRatio >= 0.8) return 'boolean';

  const dateRatio = nonEmpty.filter((value) => isDateLike(value)).length / nonEmpty.length;
  if (dateRatio >= 0.7) return 'datetime';

  const idRatio = nonEmpty.filter((value) => isIdLike(value)).length / nonEmpty.length;
  if (idRatio >= 0.7) return 'id';

  return 'text';
}

function getMinWidthForType(type) {
  return MIN_WIDTHS_PX[type] || MIN_WIDTHS_PX.text;
}

function clampColumnWidth(minWidth, measuredWidthPx) {
  if (!Number.isFinite(measuredWidthPx) || measuredWidthPx <= 0) {
    return minWidth;
  }
  const boosted = measuredWidthPx * 1.1;
  return Math.min(Math.max(minWidth, boosted), minWidth * 3);
}

function estimateNumericWidthPx(sampleValues = [], grandTotalValue = '') {
  const values = [...sampleValues, grandTotalValue]
    .map((value) => normalizeCellText(value).replace(/\s+/g, '').trim())
    .filter(Boolean);
  if (values.length === 0) return MIN_WIDTHS_PX.numeric;
  const maxChars = values.reduce((max, value) => Math.max(max, value.length), 0);
  const boundedChars = Math.min(NUMERIC_WIDTH_ESTIMATE.maxChars, maxChars);
  const estimated =
    boundedChars * NUMERIC_WIDTH_ESTIMATE.charPx + NUMERIC_WIDTH_ESTIMATE.paddingPx;
  return Math.max(MIN_WIDTHS_PX.numeric, estimated);
}

function hasCellValue(cell) {
  return hasMeaningfulText(cell?.text);
}

function shouldSuppressEmptyColumns(tableData, options = {}) {
  if (options.suppressEmptyColumns === false) {
    return false;
  }
  return String(tableData?.metadata?.tableType || '').toLowerCase() === 'data';
}

function filterTrulyEmptyColumns(columns, normalizedRows, normalizedGrandTotal) {
  // Preserve schema for legitimate empty-result reports. When there are no rows
  // and no grand total evidence, we cannot infer truly empty columns.
  if (normalizedRows.length === 0 && !normalizedGrandTotal) {
    return {
      columns,
      normalizedRows,
      normalizedGrandTotal,
      hiddenEmptyColumns: [],
    };
  }

  const keepSourceIndices = columns
    .filter((column) => {
      const sourceIndex = column.index;
      const hasValueInRows = normalizedRows.some((rowCells) =>
        hasCellValue(rowCells?.[sourceIndex]),
      );
      if (hasValueInRows) return true;
      return hasCellValue(normalizedGrandTotal?.[sourceIndex]);
    })
    .map((column) => column.index);

  // Keep at least one data column to avoid generating an empty table.
  if (keepSourceIndices.length === 0 && columns.length > 0) {
    keepSourceIndices.push(columns[0].index);
  }

  if (keepSourceIndices.length === columns.length) {
    return {
      columns,
      normalizedRows,
      normalizedGrandTotal,
      hiddenEmptyColumns: [],
    };
  }

  const keepSourceSet = new Set(keepSourceIndices);
  const hiddenEmptyColumns = columns
    .filter((column) => !keepSourceSet.has(column.index))
    .map((column) => ({
      columnId: column.columnId,
      label: column.label,
    }));

  const reindexedColumns = keepSourceIndices
    .map((sourceIndex) => columns.find((column) => column.index === sourceIndex))
    .filter(Boolean)
    .map((column, index) => ({
      ...column,
      index,
    }));

  const filteredRows = normalizedRows.map((rowCells = []) =>
    keepSourceIndices.map((sourceIndex) => cloneCell(rowCells[sourceIndex])),
  );

  const filteredGrandTotal = normalizedGrandTotal
    ? keepSourceIndices.map((sourceIndex) => cloneCell(normalizedGrandTotal[sourceIndex]))
    : null;

  return {
    columns: reindexedColumns,
    normalizedRows: filteredRows,
    normalizedGrandTotal: filteredGrandTotal,
    hiddenEmptyColumns,
  };
}

function extractLeafHeaderCells(headers = []) {
  if (!headers.length) return [];
  const headerRows = headers.map((headerRow) => {
    if (Array.isArray(headerRow)) return headerRow;
    if (Array.isArray(headerRow?.cells)) return headerRow.cells;
    return [];
  });

  if (!headerRows.length) return [];

  const rowCount = headerRows.length;
  const matrix = Array.from({ length: rowCount }, () => []);

  const createBaseCell = (cell = {}) => ({
    text: normalizeCellText(cell.text),
    colspan: 1,
    rowspan: 1,
    className: cell.className || '',
    columnId: cell.columnId || null,
    isHeader: Boolean(cell.isHeader),
    isNumeric: Boolean(cell.isNumeric),
    measuredWidthPx: Number(cell.measuredWidthPx) || null,
  });

  const createContinuationCell = (cell = {}) => ({
    text: '',
    colspan: 1,
    rowspan: 1,
    className: cell.className || '',
    columnId: null,
    isHeader: Boolean(cell.isHeader),
    isNumeric: Boolean(cell.isNumeric),
    measuredWidthPx: null,
  });

  headerRows.forEach((rowCells, rowIndex) => {
    let colIndex = 0;

    rowCells.forEach((cell) => {
      while (matrix[rowIndex][colIndex] !== undefined) {
        colIndex += 1;
      }

      const spanCols = Math.max(1, Number(cell?.colspan || 1));
      const spanRows = Math.max(1, Number(cell?.rowspan || 1));

      for (let rowOffset = 0; rowOffset < spanRows; rowOffset += 1) {
        const targetRow = rowIndex + rowOffset;
        if (targetRow >= rowCount) break;

        for (let colOffset = 0; colOffset < spanCols; colOffset += 1) {
          const targetCol = colIndex + colOffset;
          if (matrix[targetRow][targetCol] !== undefined) continue;

          matrix[targetRow][targetCol] =
            colOffset === 0 ? createBaseCell(cell) : createContinuationCell(cell);
        }
      }

      colIndex += spanCols;
    });
  });

  const leafRowIndex = rowCount - 1;
  const leafCount = matrix.reduce((max, row) => Math.max(max, row.length), 0);
  const leafCells = [];

  for (let colIndex = 0; colIndex < leafCount; colIndex += 1) {
    let resolved = matrix[leafRowIndex][colIndex];

    if (!resolved) {
      for (let rowIndex = leafRowIndex - 1; rowIndex >= 0; rowIndex -= 1) {
        if (matrix[rowIndex][colIndex]) {
          resolved = matrix[rowIndex][colIndex];
          break;
        }
      }
    }

    leafCells.push(
      resolved || {
        text: '',
        colspan: 1,
        rowspan: 1,
        className: '',
        columnId: null,
        isHeader: false,
        isNumeric: false,
        measuredWidthPx: null,
      },
    );
  }

  return leafCells;
}

function buildLegacyColumns(tableData) {
  const metadata = tableData?.metadata || {};
  const metadataColumns = Array.isArray(metadata.columns) ? metadata.columns : [];

  if (metadataColumns.length > 0) {
    return metadataColumns.map((column, index) => {
      const isNumeric = Boolean(column?.isNumeric);
      const type = isNumeric ? 'numeric' : 'text';
      const minWidthPx = getMinWidthForType(type);
      const measuredWidthPx = Number(column?.measuredWidthPx) || null;
      return {
        index,
        columnId: column?.columnId || `col_${index + 1}`,
        label: column?.label || `Column ${index + 1}`,
        type,
        minWidthPx,
        widthPx: clampColumnWidth(minWidthPx, measuredWidthPx),
        isNumeric,
      };
    });
  }

  const leafHeaders = extractLeafHeaderCells(tableData?.headers || []);
  if (leafHeaders.length > 0) {
    return leafHeaders.map((headerCell, index) => {
      const isNumeric = Boolean(headerCell?.isNumeric);
      const type = isNumeric ? 'numeric' : 'text';
      const minWidthPx = getMinWidthForType(type);
      const measuredWidthPx = Number(headerCell?.measuredWidthPx) || null;
      return {
        index,
        columnId: headerCell?.columnId || `col_${index + 1}`,
        label: headerCell?.text || `Column ${index + 1}`,
        type,
        minWidthPx,
        widthPx: clampColumnWidth(minWidthPx, measuredWidthPx),
        isNumeric,
      };
    });
  }

  const fallbackCount = Math.max(0, Number(metadata.totalColumns || 0));
  return Array.from({ length: fallbackCount }).map((_, index) => ({
    index,
    columnId: `col_${index + 1}`,
    label: `Column ${index + 1}`,
    type: 'text',
    minWidthPx: MIN_WIDTHS_PX.text,
    widthPx: MIN_WIDTHS_PX.text,
    isNumeric: false,
  }));
}

function buildColumns(tableData, options = {}) {
  const headers = tableData?.headers || [];
  const rows = tableData?.rows || [];
  const metadata = tableData?.metadata || {};

  const leafHeaders = extractLeafHeaderCells(headers);
  const maxCellsInRows = rows.reduce((max, row) => {
    const expandedCount = expandCells(row.cells || []).length;
    return Math.max(max, expandedCount);
  }, 0);
  const leafCount = Math.max(
    leafHeaders.length,
    Number(metadata.totalColumns || 0),
    maxCellsInRows,
  );

  const normalizedRows = normalizeRowsWithRowspan(rows, leafCount);
  const normalizedGrandTotal = tableData?.grandTotal
    ? normalizeRowCells(tableData.grandTotal.cells || [], leafCount)
    : null;
  const columnsMeta = metadata.columns;

  const columns = [];
  for (let index = 0; index < leafCount; index += 1) {
    const headerCell = leafHeaders[index] || {};
    const label = normalizeCellText(headerCell.text) || `Column ${index + 1}`;
    const columnId = headerCell.columnId || `col_${index + 1}`;
    const columnMeta = getColumnMeta(columnsMeta, headerCell.columnId, index);
    const sampleValues = normalizedRows
      .slice(0, 50)
      .map((rowCells) => rowCells[index]?.text ?? '');
    const grandTotalValue = normalizedGrandTotal?.[index]?.text ?? '';
    const type = inferColumnType(
      { ...headerCell, isNumeric: Boolean(headerCell?.isNumeric || columnMeta?.isNumeric) },
      [...sampleValues, grandTotalValue],
    );
    const minWidthPx = getMinWidthForType(type);
    const measuredWidthPx = getColumnMeasuredWidth(columnsMeta, headerCell.columnId, index);
    let widthPx = clampColumnWidth(minWidthPx, measuredWidthPx);
    if (type === 'numeric') {
      widthPx = Math.max(widthPx, estimateNumericWidthPx(sampleValues, grandTotalValue));
    }

    columns.push({
      index,
      columnId,
      label,
      type,
      minWidthPx,
      widthPx,
      isNumeric: type === 'numeric',
    });
  }

  if (shouldSuppressEmptyColumns(tableData, options)) {
    return filterTrulyEmptyColumns(columns, normalizedRows, normalizedGrandTotal);
  }

  return {
    columns,
    normalizedRows,
    normalizedGrandTotal,
    hiddenEmptyColumns: [],
  };
}

function buildCandidateLayouts(pageSize, orientation) {
  const requestedSize = normalizePageSize(pageSize || 'Letter');
  const requestedOrientation = normalizeOrientation(orientation);
  const candidates = [];
  const pushCandidate = (size, dir) => {
    const existing = candidates.find(
      (candidate) => candidate.pageSize === size && candidate.orientation === dir,
    );
    if (!existing) {
      candidates.push({
        pageSize: size,
        orientation: dir,
        printableWidthPx: getPrintableWidthPx(size, dir),
      });
    }
  };

  pushCandidate(requestedSize, requestedOrientation);
  pushCandidate(
    requestedSize,
    requestedOrientation === 'portrait' ? 'landscape' : 'portrait',
  );

  const startIndex = Math.max(0, WIDER_PAGE_ORDER.indexOf(requestedSize));
  for (let i = startIndex; i < WIDER_PAGE_ORDER.length; i += 1) {
    pushCandidate(WIDER_PAGE_ORDER[i], 'landscape');
  }

  return candidates;
}

function getWidestCandidate(candidates = []) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  return candidates.reduce((widest, candidate) => {
    if (!widest) return candidate;
    return candidate.printableWidthPx > widest.printableWidthPx ? candidate : widest;
  }, null);
}

function selectAnchorColumns(columns, printableWidthPx) {
  const maxAnchorWidth = printableWidthPx * 0.35;
  const anchors = [];
  let consumed = 0;

  for (const column of columns) {
    if (anchors.length >= 2) break;
    if (column.isNumeric) continue;
    if (consumed + column.widthPx > maxAnchorWidth && anchors.length > 0) continue;
    anchors.push(column.index);
    consumed += column.widthPx;
  }

  if (anchors.length === 0 && columns.length > 0) {
    anchors.push(columns[0].index);
  }

  return anchors;
}

function buildBands(columns, printableWidthPx) {
  const rowNumberWidth = MIN_WIDTHS_PX.rowNumber;
  const minDynamicWidth = MIN_WIDTHS_PX.text;
  let anchorIndices = selectAnchorColumns(columns, printableWidthPx);
  const getAnchorWidth = (indices) =>
    indices.reduce((sum, index) => sum + (columns[index]?.widthPx || 0), rowNumberWidth);
  let dynamicIndices = columns
    .map((column) => column.index)
    .filter((index) => !anchorIndices.includes(index));

  if (dynamicIndices.length > 0) {
    let anchorWidth = getAnchorWidth(anchorIndices);
    // If anchors consume too much horizontal budget, trim trailing anchors to keep
    // at least one reasonably readable dynamic column in each band.
    while (anchorIndices.length > 0 && printableWidthPx - anchorWidth < minDynamicWidth) {
      anchorIndices = anchorIndices.slice(0, -1);
      anchorWidth = getAnchorWidth(anchorIndices);
    }
    dynamicIndices = columns
      .map((column) => column.index)
      .filter((index) => !anchorIndices.includes(index));
  }

  const anchorWidth = getAnchorWidth(anchorIndices);
  const availableForDynamic = Math.max(40, printableWidthPx - anchorWidth);
  const dynamicWidthByIndex = {};

  const bands = [];
  let current = [];
  let currentWidth = 0;

  dynamicIndices.forEach((index) => {
    const rawWidth = columns[index]?.widthPx || MIN_WIDTHS_PX.text;
    const width = Math.min(rawWidth, availableForDynamic);
    dynamicWidthByIndex[index] = width;
    if (current.length > 0 && currentWidth + width > availableForDynamic) {
      bands.push(current);
      current = [index];
      currentWidth = width;
      return;
    }
    current.push(index);
    currentWidth += width;
  });

  if (current.length > 0) {
    bands.push(current);
  }

  if (bands.length === 0) {
    bands.push([]);
  }

  return {
    anchorIndices,
    rowNumberWidth,
    bands,
    dynamicWidthByIndex,
  };
}

function cloneCell(cell = {}) {
  return {
    text: normalizeCellText(cell.text),
    colspan: 1,
    rowspan: 1,
    className: cell.className || '',
    columnId: cell.columnId || null,
    isHeader: Boolean(cell.isHeader),
    isNumeric: Boolean(cell.isNumeric),
  };
}

function withClassToken(className, token) {
  const parts = String(className || '')
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.includes(token)) {
    parts.push(token);
  }
  return parts.join(' ');
}

function isSubtotalLike(row) {
  return String(row?.type || '').toLowerCase().includes('subtotal');
}

function formatRowNumber(row, fallbackIndex) {
  if (isSubtotalLike(row)) return '';
  if (typeof row?.index === 'number' && Number.isFinite(row.index)) {
    return String(row.index + 1);
  }
  return String(fallbackIndex + 1);
}

function buildBandHeaderCells(
  columns,
  selectedIndices,
  includeRowNumber,
  rowNumberWidth,
  widthOverridesByIndex = {},
) {
  const cells = [];
  const descriptors = [];

  if (includeRowNumber) {
    descriptors.push({
      columnId: '__row_number__',
      label: 'Row #',
      widthPx: rowNumberWidth,
      isNumeric: true,
      sourceIndex: null,
    });
    cells.push({
      text: 'Row #',
      colspan: 1,
      rowspan: 1,
      className: 'numeric',
      columnId: '__row_number__',
      isHeader: true,
      isNumeric: true,
    });
  }

  selectedIndices.forEach((index) => {
    const column = columns[index];
    const overrideWidth = Number(widthOverridesByIndex[index]);
    const widthPx =
      Number.isFinite(overrideWidth) && overrideWidth > 0
        ? overrideWidth
        : column.widthPx;
    descriptors.push({
      columnId: column.columnId,
      label: column.label,
      widthPx,
      isNumeric: column.isNumeric,
      sourceIndex: index,
    });
    cells.push({
      text: column.label,
      colspan: 1,
      rowspan: 1,
      className: column.isNumeric ? 'numeric' : '',
      columnId: column.columnId,
      isHeader: true,
      isNumeric: column.isNumeric,
    });
  });

  return { cells, descriptors };
}

function buildBandRows(
  rows,
  normalizedRows,
  columns,
  selectedIndices,
  includeRowNumber,
) {
  const numericByIndex = new Map(
    columns.filter((column) => column.isNumeric).map((column) => [column.index, true]),
  );

  return rows.map((row, rowIndex) => {
    const normalized = normalizedRows[rowIndex] || [];
    const cells = [];

    if (includeRowNumber) {
      cells.push({
        text: formatRowNumber(row, rowIndex),
        colspan: 1,
        rowspan: 1,
        className: 'numeric row-number',
        columnId: '__row_number__',
        isHeader: false,
        isNumeric: true,
      });
    }

    selectedIndices.forEach((index) => {
      const cloned = cloneCell(normalized[index]);
      if (numericByIndex.get(index)) {
        cloned.isNumeric = true;
        cloned.className = withClassToken(cloned.className, 'numeric');
      }
      cells.push(cloned);
    });

    return {
      ...row,
      cells,
    };
  });
}

function buildBandGrandTotal(
  normalizedGrandTotal,
  columns,
  selectedIndices,
  includeRowNumber,
) {
  if (!normalizedGrandTotal) return null;
  const numericByIndex = new Map(
    columns.filter((column) => column.isNumeric).map((column) => [column.index, true]),
  );
  const cells = [];

  if (includeRowNumber) {
    cells.push({
      text: '',
      colspan: 1,
      rowspan: 1,
      className: 'numeric row-number',
      columnId: '__row_number__',
      isHeader: false,
      isNumeric: true,
    });
  }

  selectedIndices.forEach((index) => {
    const cloned = cloneCell(normalizedGrandTotal[index]);
    if (numericByIndex.get(index)) {
      cloned.isNumeric = true;
      cloned.className = withClassToken(cloned.className, 'numeric');
    }
    cells.push(cloned);
  });

  return { cells };
}

export function buildWideTableLayout(tableData, options = {}) {
  const requestedPageSize = normalizePageSize(options.pageSize || 'Letter');
  const requestedOrientation = normalizeOrientation(options.orientation || 'portrait');
  const strategy = options.wideTableStrategy || 'auto';
  // Wide layout is the default behavior for modern table exports.
  // Legacy mode is available only via explicit opt-out.
  const shouldApplyEngine = strategy !== 'legacy';

  if (!shouldApplyEngine) {
    const columns = buildLegacyColumns(tableData);
    return {
      sections: [
        {
          headers: tableData.headers || [],
          rows: tableData.rows || [],
          grandTotal: tableData.grandTotal || null,
          bandLabel: null,
          columns: columns.map((column) => ({
            columnId: column.columnId,
            label: column.label,
            widthPx: column.widthPx,
            isNumeric: column.isNumeric,
          })),
        },
      ],
      layoutApplied: {
        requestedPageSize,
        requestedOrientation,
        effectivePageSize: requestedPageSize,
        effectiveOrientation: requestedOrientation,
        usedBanding: false,
        bandCount: 1,
        totalColumns: columns.length,
        anchorColumns: [],
        autoAdjustedLayout: false,
        strategyApplied: 'legacy',
      },
    };
  }

  const {
    columns,
    normalizedRows,
    normalizedGrandTotal,
    hiddenEmptyColumns,
  } = buildColumns(tableData, options);
  const requiredWidthPx = columns.reduce((sum, column) => sum + column.widthPx, 0);
  const candidates = buildCandidateLayouts(requestedPageSize, requestedOrientation);
  let chosen = candidates.find((candidate) => requiredWidthPx <= candidate.printableWidthPx);

  if (strategy === 'fit' && !chosen) {
    chosen = getWidestCandidate(candidates);
  }

  if (chosen && strategy !== 'horizontal_paginate') {
    const selectedIndices = columns.map((column) => column.index);
    const hasSuppressedColumns = hiddenEmptyColumns.length > 0;
    const { cells: fitHeaderCells } = buildBandHeaderCells(
      columns,
      selectedIndices,
      false,
      MIN_WIDTHS_PX.rowNumber,
    );
    const fitRows = buildBandRows(
      tableData.rows || [],
      normalizedRows,
      columns,
      selectedIndices,
      false,
    );
    const fitGrandTotal = buildBandGrandTotal(
      normalizedGrandTotal,
      columns,
      selectedIndices,
      false,
    );

    return {
      sections: [
        {
          headers: hasSuppressedColumns ? [{ cells: fitHeaderCells }] : tableData.headers || [],
          rows: hasSuppressedColumns ? fitRows : tableData.rows || [],
          grandTotal: hasSuppressedColumns ? fitGrandTotal : tableData.grandTotal || null,
          bandLabel: null,
          columns: columns.map((column) => ({
            columnId: column.columnId,
            label: column.label,
            widthPx: column.widthPx,
            isNumeric: column.isNumeric,
          })),
        },
      ],
      layoutApplied: {
        requestedPageSize,
        requestedOrientation,
        effectivePageSize: chosen.pageSize,
        effectiveOrientation: chosen.orientation,
        usedBanding: false,
        bandCount: 1,
        totalColumns: columns.length,
        anchorColumns: [],
        autoAdjustedLayout:
          chosen.pageSize !== requestedPageSize ||
          chosen.orientation !== requestedOrientation,
        strategyApplied: 'fit',
        hiddenEmptyColumnCount: hiddenEmptyColumns.length,
        hiddenEmptyColumns: hiddenEmptyColumns.map((column) => column.label),
      },
    };
  }

  const fallback = chosen || getWidestCandidate(candidates);
  const bandingPlan = buildBands(columns, fallback.printableWidthPx);
  const anchorLabels = bandingPlan.anchorIndices.map((index) => columns[index]?.label).filter(Boolean);
  const sections = bandingPlan.bands.map((dynamicIndices, bandIndex) => {
    const selectedIndices = [...bandingPlan.anchorIndices, ...dynamicIndices];
    const { cells: headerCells, descriptors } = buildBandHeaderCells(
      columns,
      selectedIndices,
      true,
      bandingPlan.rowNumberWidth,
      bandingPlan.dynamicWidthByIndex,
    );
    const rows = buildBandRows(
      tableData.rows || [],
      normalizedRows,
      columns,
      selectedIndices,
      true,
    );
    const grandTotal = buildBandGrandTotal(
      normalizedGrandTotal,
      columns,
      selectedIndices,
      true,
    );

    const dynamicSorted = [...dynamicIndices].sort((a, b) => a - b);
    const start = dynamicSorted.length ? dynamicSorted[0] + 1 : 1;
    const end = dynamicSorted.length
      ? dynamicSorted[dynamicSorted.length - 1] + 1
      : columns.length;
    const bandLabel = `Columns ${start}-${end} of ${columns.length}`;

    return {
      headers: [{ cells: headerCells }],
      rows,
      grandTotal,
      bandLabel,
      bandIndex: bandIndex + 1,
      columns: descriptors.map((descriptor) => ({
        columnId: descriptor.columnId,
        label: descriptor.label,
        widthPx: descriptor.widthPx,
        isNumeric: descriptor.isNumeric,
      })),
    };
  });

  return {
    sections,
    layoutApplied: {
      requestedPageSize,
      requestedOrientation,
      effectivePageSize: fallback.pageSize,
      effectiveOrientation: fallback.orientation,
      usedBanding: true,
      bandCount: sections.length,
      totalColumns: columns.length,
      anchorColumns: anchorLabels,
      autoAdjustedLayout:
        fallback.pageSize !== requestedPageSize ||
        fallback.orientation !== requestedOrientation,
      strategyApplied: 'horizontal_paginate',
      hiddenEmptyColumnCount: hiddenEmptyColumns.length,
      hiddenEmptyColumns: hiddenEmptyColumns.map((column) => column.label),
    },
  };
}
