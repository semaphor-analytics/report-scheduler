import {
  estimateColumnWidthPx,
  getColumnWidthBounds,
} from './table-column-widths.js';

function normalizeCellText(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function normalizeHeaderCell(cell = {}) {
  return {
    text: normalizeCellText(cell.text),
    colspan: 1,
    rowspan: 1,
    className: cell.className || '',
    columnId: cell.columnId || null,
    isHeader: Boolean(cell.isHeader),
    ...(typeof cell.isNumeric === 'boolean' ? { isNumeric: cell.isNumeric } : {}),
    ...(typeof cell.pdfIsNumeric === 'boolean'
      ? { pdfIsNumeric: cell.pdfIsNumeric }
      : {}),
    measuredWidthPx: Number(cell.measuredWidthPx) || null,
  };
}

function getHeaderRows(headers = []) {
  if (!Array.isArray(headers)) return [];
  return headers.map((headerRow) => {
    if (Array.isArray(headerRow)) return headerRow;
    if (Array.isArray(headerRow?.cells)) return headerRow.cells;
    return [];
  });
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

function withoutNumericClassTokens(className) {
  return String(className || '')
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(
      (part) =>
        part &&
        part !== 'numeric' &&
        part !== 'text-right' &&
        part !== 'text-end',
    )
    .join(' ');
}

function getColumnIndexById(columns = []) {
  return new Map(
    columns
      .map((column, index) => [column?.columnId, index])
      .filter(([columnId]) => columnId),
  );
}

/**
 * Resolve authored PDF semantics once. The explicit PDF hint is the strongest
 * signal, followed by normalized column metadata and then the extracted or
 * structured cell alignment. Value inference is intentionally left to the
 * table model when no authored signal exists.
 */
function resolvePdfNumericSemantic(headerCell = {}, columnMeta = null) {
  if (typeof headerCell.pdfIsNumeric === 'boolean') {
    return headerCell.pdfIsNumeric;
  }
  if (typeof columnMeta?.isNumeric === 'boolean') {
    return columnMeta.isNumeric;
  }
  if (typeof headerCell.isNumeric === 'boolean') {
    return headerCell.isNumeric;
  }
  return undefined;
}

function applyResolvedColumnSemantics(cell = {}, column = null) {
  const isNumeric = Boolean(column?.isNumeric);
  const className = withoutNumericClassTokens(cell.className);
  return {
    ...cell,
    className: isNumeric ? withClassToken(className, 'numeric') : className,
    isNumeric,
  };
}

function buildBlankBodyCell(column = null, continuation = null) {
  return applyResolvedColumnSemantics(
    {
      text: '',
      colspan: 1,
      rowspan: 1,
      className: continuation?.className || '',
      columnId: column?.columnId || null,
      isHeader: Boolean(continuation?.isHeader),
    },
    column,
  );
}

/**
 * Project resolved column meaning onto body or total rows and flatten authored
 * rowspans into one visible value followed by blank physical cells. Chromium
 * fragments long body rowspans unreliably across pages and can move the table
 * below the report header or paint over the footer. Blank continuation cells
 * preserve the intended "show once" presentation without cross-page spans.
 */
function normalizeRowsWithColumnSemantics(rows = [], columns = []) {
  const activeRowspans = Array.from({ length: columns.length }, () => null);
  const columnIndexById = getColumnIndexById(columns);

  return rows.map((row = {}) => {
    const occupied = activeRowspans.map((span) => Boolean(span?.remaining));
    const normalizedCells = [];
    let cursor = 0;

    const emitColumnsBefore = (targetIndex) => {
      while (cursor < targetIndex && cursor < columns.length) {
        normalizedCells.push(
          buildBlankBodyCell(columns[cursor], activeRowspans[cursor]),
        );
        cursor += 1;
      }
    };

    (row.cells || []).forEach((cell = {}) => {
      while (cursor < columns.length && occupied[cursor]) {
        normalizedCells.push(
          buildBlankBodyCell(columns[cursor], activeRowspans[cursor]),
        );
        cursor += 1;
      }

      const explicitIndex = cell.columnId
        ? columnIndexById.get(cell.columnId)
        : undefined;
      const sourceIndex = Math.max(cursor, explicitIndex ?? cursor);
      emitColumnsBefore(sourceIndex);

      const colspan = Math.max(1, Number(cell.colspan || 1));
      const rowspan = Math.max(1, Number(cell.rowspan || 1));
      const sourceCell = {
        ...cell,
        colspan,
        rowspan: 1,
      };

      normalizedCells.push(
        colspan > 1 || !columns[sourceIndex]
          ? applyResolvedColumnSemantics(sourceCell, { isNumeric: false })
          : applyResolvedColumnSemantics(sourceCell, columns[sourceIndex]),
      );

      if (rowspan > 1) {
        for (let offset = 0; offset < colspan; offset += 1) {
          const targetIndex = sourceIndex + offset;
          if (targetIndex < activeRowspans.length) {
            activeRowspans[targetIndex] = {
              remaining: rowspan - 1,
              className: cell.className || '',
              isHeader: Boolean(cell.isHeader),
            };
          }
        }
      }

      cursor = sourceIndex + colspan;
    });

    emitColumnsBefore(columns.length);

    activeRowspans.forEach((span, index) => {
      if (!occupied[index] || !span?.remaining) return;
      span.remaining -= 1;
      if (span.remaining <= 0) {
        activeRowspans[index] = null;
      }
    });

    return {
      ...row,
      cells: normalizedCells,
    };
  });
}

function buildHeaderTopology(headers = []) {
  const headerRows = getHeaderRows(headers);
  if (headerRows.length === 0) {
    return { headerRows: [], rowSources: [], matrix: [], placements: [], leafCells: [] };
  }

  const rowCount = headerRows.length;
  const rowSources = headers.map((headerRow) =>
    Array.isArray(headerRow) ? {} : headerRow || {},
  );
  const matrix = Array.from({ length: rowCount }, () => []);
  const placements = [];

  headerRows.forEach((rowCells, rowIndex) => {
    let columnIndex = 0;

    rowCells.forEach((cell = {}, cellIndex) => {
      while (matrix[rowIndex][columnIndex] !== undefined) {
        columnIndex += 1;
      }

      const colspan = Math.max(1, Number(cell.colspan || 1));
      const rowspan = Math.max(1, Number(cell.rowspan || 1));
      const placement = {
        id: `${rowIndex}:${cellIndex}`,
        rowIndex,
        startCol: columnIndex,
        endCol: columnIndex + colspan - 1,
        colspan,
        rowspan,
        cell: normalizeHeaderCell(cell),
        hasChildHeaders: false,
      };
      placements.push(placement);

      for (let rowOffset = 0; rowOffset < rowspan; rowOffset += 1) {
        const targetRow = rowIndex + rowOffset;
        if (targetRow >= rowCount) break;

        for (let columnOffset = 0; columnOffset < colspan; columnOffset += 1) {
          const targetColumn = columnIndex + columnOffset;
          if (matrix[targetRow][targetColumn] === undefined) {
            matrix[targetRow][targetColumn] = placement;
          }
        }
      }

      columnIndex += colspan;
    });
  });

  placements.forEach((placement) => {
    placement.hasChildHeaders = placements.some(
      (candidate) =>
        candidate.rowIndex > placement.rowIndex &&
        candidate.startCol <= placement.endCol &&
        candidate.endCol >= placement.startCol,
    );
  });

  const leafRowIndex = rowCount - 1;
  const leafCount = matrix.reduce((max, row) => Math.max(max, row.length), 0);

  const leafCells = Array.from({ length: leafCount }, (_, columnIndex) => {
    let placement = null;
    for (let rowIndex = leafRowIndex; rowIndex >= 0; rowIndex -= 1) {
      if (matrix[rowIndex][columnIndex]) {
        placement = matrix[rowIndex][columnIndex];
        break;
      }
    }

    if (!placement) return normalizeHeaderCell();

    const offset = columnIndex - placement.startCol;
    const ownsLeafSemantics = placement.colspan === 1 || !placement.hasChildHeaders;
    const source = placement.cell;
    const apportionedWidth =
      ownsLeafSemantics && Number.isFinite(source.measuredWidthPx) && source.measuredWidthPx > 0
        ? source.measuredWidthPx / placement.colspan
        : null;

    return {
      text: source.text,
      colspan: 1,
      rowspan: 1,
      className: source.className,
      columnId:
        ownsLeafSemantics && offset === 0
          ? source.columnId
          : null,
      isHeader: source.isHeader,
      ...(ownsLeafSemantics && typeof source.isNumeric === 'boolean'
        ? { isNumeric: source.isNumeric }
        : {}),
      ...(ownsLeafSemantics && typeof source.pdfIsNumeric === 'boolean'
        ? { pdfIsNumeric: source.pdfIsNumeric }
        : {}),
      measuredWidthPx: apportionedWidth,
    };
  });

  return { headerRows, rowSources, matrix, placements, leafCells };
}

function createEmptyPhysicalCell() {
  return {
    text: '',
    colspan: 1,
    rowspan: 1,
    className: '',
    columnId: null,
    isHeader: false,
    measuredWidthPx: null,
  };
}

function createPhysicalCell(cell = {}, overrides = {}) {
  return {
    text: normalizeCellText(cell.text),
    colspan: 1,
    rowspan: 1,
    className: cell.className || '',
    columnId: cell.columnId || null,
    isHeader: Boolean(cell.isHeader),
    ...(typeof cell.isNumeric === 'boolean' ? { isNumeric: cell.isNumeric } : {}),
    ...(typeof cell.pdfIsNumeric === 'boolean'
      ? { pdfIsNumeric: cell.pdfIsNumeric }
      : {}),
    measuredWidthPx: Number(cell.measuredWidthPx) || null,
    ...overrides,
  };
}

function getExpandedCellCount(cells = []) {
  return cells.reduce(
    (count, cell) => count + Math.max(1, Number(cell?.colspan || 1)),
    0,
  );
}

function normalizePhysicalRows(rows = [], leafCount = 0) {
  const carryByColumn = Array.from({ length: leafCount }, () => 0);

  return rows.map((row = {}) => {
    const normalized = Array.from({ length: leafCount }, () => null);
    let cursor = 0;

    const consumeCarriedColumns = () => {
      while (cursor < leafCount && carryByColumn[cursor] > 0) {
        normalized[cursor] = createEmptyPhysicalCell();
        carryByColumn[cursor] -= 1;
        cursor += 1;
      }
    };

    consumeCarriedColumns();

    (row.cells || []).forEach((cell = {}) => {
      consumeCarriedColumns();
      if (cursor >= leafCount) return;

      const colspan = Math.max(1, Number(cell.colspan || 1));
      const rowspan = Math.max(1, Number(cell.rowspan || 1));

      for (let offset = 0; offset < colspan; offset += 1) {
        const targetIndex = cursor + offset;
        if (targetIndex >= leafCount) break;

        normalized[targetIndex] =
          offset === 0
            ? createPhysicalCell(cell)
            : createPhysicalCell(cell, {
                text: '',
                columnId: null,
                measuredWidthPx: null,
              });

        if (rowspan > 1) {
          carryByColumn[targetIndex] = Math.max(
            carryByColumn[targetIndex],
            rowspan - 1,
          );
        }
      }

      cursor += colspan;
    });

    while (cursor < leafCount) {
      if (carryByColumn[cursor] > 0) {
        carryByColumn[cursor] -= 1;
      }
      normalized[cursor] = normalized[cursor] || createEmptyPhysicalCell();
      cursor += 1;
    }

    return normalized.map((cell) => cell || createEmptyPhysicalCell());
  });
}

function normalizePhysicalTotal(total = null, leafCount = 0) {
  if (!total) return null;
  const cells = [];
  (total.cells || []).forEach((cell = {}) => {
    const colspan = Math.max(1, Number(cell.colspan || 1));
    cells.push(createPhysicalCell(cell));
    for (let offset = 1; offset < colspan; offset += 1) {
      cells.push(
        createPhysicalCell(cell, {
          text: '',
          columnId: null,
          measuredWidthPx: null,
        }),
      );
    }
  });
  while (cells.length < leafCount) cells.push(createEmptyPhysicalCell());
  return cells.slice(0, leafCount);
}

function isMissingLike(value) {
  const normalized = normalizeCellText(value).trim().toLowerCase();
  if (!normalized) return true;
  return ['-', '—', '–', 'n/a', 'na', 'null', 'none'].includes(normalized);
}

function isBooleanLike(value) {
  const normalized = normalizeCellText(value).trim().toLowerCase();
  return ['true', 'false', 'yes', 'no', 'y', 'n', 'on', 'off'].includes(normalized);
}

function isDateLike(value) {
  const text = normalizeCellText(value).trim();
  if (!text) return false;
  return (
    /^\d{4}-\d{2}-\d{2}/.test(text) ||
    /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(text) ||
    /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(text)
  );
}

function isIdLike(value) {
  const text = normalizeCellText(value).trim();
  return Boolean(text && !text.includes(' ') && /^[a-z0-9_.:-]{8,}$/i.test(text));
}

function isNumericLike(value) {
  if (typeof value === 'number') return true;
  const normalized = normalizeCellText(value)
    .trim()
    .replace(/^\((.*)\)$/, '-$1')
    .replace(/[$,%\s]/g, '')
    .replace(/,/g, '');
  return Boolean(normalized && /^-?\d+(\.\d+)?$/.test(normalized));
}

function isStrictThousandsFormattedNumber(value) {
  const normalized = normalizeCellText(value)
    .trim()
    .replace(/^\((.*)\)$/, '-$1')
    .replace(/[$%\s]/g, '');
  return Boolean(
    normalized && /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(normalized),
  );
}

function isDelimitedIdentifierList(value) {
  const text = normalizeCellText(value).trim();
  if (!text.includes(',')) return false;

  const parts = text.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return false;
  if (!parts.every((part) => /^[a-z0-9_.:/-]+$/i.test(part))) return false;
  if (/\,\s+/.test(text)) return true;
  if (isStrictThousandsFormattedNumber(text)) return false;
  return parts.some((part) => !/^\d+$/.test(part));
}

function getColumnMeta(columnsMeta, columnId, index) {
  if (!Array.isArray(columnsMeta)) return null;
  const exact = columnsMeta.find(
    (column) => column?.columnId && column.columnId === columnId,
  );
  return exact || columnsMeta[index] || null;
}

function inferColumnType(headerCell, columnMeta, sampleValues) {
  const authoredNumeric = resolvePdfNumericSemantic(headerCell, columnMeta);
  if (typeof authoredNumeric === 'boolean') {
    return authoredNumeric ? 'numeric' : 'text';
  }

  const nonEmpty = sampleValues.filter((value) => !isMissingLike(value));
  if (nonEmpty.length === 0) return 'text';
  if (nonEmpty.some((value) => isDelimitedIdentifierList(value))) return 'text';
  if (nonEmpty.filter(isNumericLike).length / nonEmpty.length >= 0.8) return 'numeric';
  if (nonEmpty.filter(isBooleanLike).length / nonEmpty.length >= 0.8) return 'boolean';
  if (nonEmpty.filter(isDateLike).length / nonEmpty.length >= 0.7) return 'datetime';
  if (nonEmpty.filter(isIdLike).length / nonEmpty.length >= 0.7) return 'id';
  return 'text';
}

function hasCellValue(cell) {
  return normalizeCellText(cell?.text).trim().length > 0;
}

function buildFlatHeaders(columns = []) {
  return [
    {
      cells: columns.map((column) =>
        applyResolvedColumnSemantics(
          {
            text: column.label,
            colspan: 1,
            rowspan: 1,
            className: '',
            columnId: column.columnId,
            isHeader: true,
          },
          column,
        ),
      ),
    },
  ];
}

function projectHeaderTopology(topology, sourceIndices, columns) {
  if (!topology.headerRows.length || !sourceIndices.length) return null;

  const sourceToOutput = new Map(
    sourceIndices.map((sourceIndex, outputIndex) => [sourceIndex, outputIndex]),
  );
  const columnBySource = new Map(columns.map((column) => [column.sourceIndex, column]));

  const coversEveryHeaderRow = sourceIndices.every((sourceIndex) =>
    topology.matrix.every((row) => Boolean(row[sourceIndex])),
  );
  if (!coversEveryHeaderRow) return null;

  const rows = topology.rowSources.map((source, rowIndex) => ({
    ...source,
    cells: [],
    __rowIndex: rowIndex,
  }));

  for (const placement of topology.placements) {
    const outputIndices = sourceIndices
      .filter(
        (sourceIndex) =>
          sourceIndex >= placement.startCol && sourceIndex <= placement.endCol,
      )
      .map((sourceIndex) => sourceToOutput.get(sourceIndex));

    if (outputIndices.length === 0) continue;
    for (let index = 1; index < outputIndices.length; index += 1) {
      if (outputIndices[index] !== outputIndices[index - 1] + 1) return null;
    }

    const projectedColumns = sourceIndices
      .filter(
        (sourceIndex) =>
          sourceIndex >= placement.startCol && sourceIndex <= placement.endCol,
      )
      .map((sourceIndex) => columnBySource.get(sourceIndex))
      .filter(Boolean);
    const isLeafPlacement =
      placement.colspan === 1 &&
      !placement.hasChildHeaders &&
      projectedColumns.length === 1;
    const isTerminalSpan = placement.colspan > 1 && !placement.hasChildHeaders;
    const hasSharedTerminalSemantic =
      isTerminalSpan &&
      projectedColumns.length > 0 &&
      projectedColumns.every(
        (column) => column.isNumeric === projectedColumns[0].isNumeric,
      );
    const sourceCell = placement.cell;
    const baseCell = {
      text: sourceCell.text,
      colspan: outputIndices.length,
      rowspan: placement.rowspan,
      className: sourceCell.className,
      columnId: isLeafPlacement ? sourceCell.columnId : null,
      isHeader: true,
      measuredWidthPx: null,
      __sortIndex: outputIndices[0],
    };

    rows[placement.rowIndex].cells.push(
      isLeafPlacement
        ? applyResolvedColumnSemantics(baseCell, projectedColumns[0])
        : hasSharedTerminalSemantic
          ? applyResolvedColumnSemantics(baseCell, projectedColumns[0])
        : applyResolvedColumnSemantics(baseCell, { isNumeric: false }),
    );
  }

  return rows.map(({ __rowIndex, ...row }) => ({
    ...row,
    cells: row.cells
      .sort((a, b) => a.__sortIndex - b.__sortIndex)
      .map(({ __sortIndex, ...cell }) => cell),
  }));
}

function clonePhysicalCell(cell = {}) {
  return {
    text: normalizeCellText(cell.text),
    colspan: 1,
    rowspan: 1,
    className: cell.className || '',
    columnId: cell.columnId || null,
    isHeader: Boolean(cell.isHeader),
    ...(typeof cell.isNumeric === 'boolean' ? { isNumeric: cell.isNumeric } : {}),
  };
}

function isPivotTableMetadata(metadata = {}) {
  return (
    String(metadata.tableType || '').toLowerCase() === 'pivot' ||
    metadata.pivotLevels !== undefined ||
    metadata.rowLevels !== undefined
  );
}

function parsePositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function resolvePivotAnchorCount(metadata, rows, topology, sourceColumns) {
  if (!isPivotTableMetadata(metadata)) return 0;

  const configured = parsePositiveInt(metadata.rowLevels);
  if (configured > 0) return Math.min(configured, sourceColumns.length);

  const firstDataRow = rows.find(
    (row) =>
      String(row?.type || 'data').toLowerCase() === 'data' &&
      Array.isArray(row?.cells),
  );
  if (firstDataRow) {
    const sawAnyHeaderCells = firstDataRow.cells.some((cell) => Boolean(cell?.isHeader));
    let bodyDerived = 0;
    for (const cell of firstDataRow.cells) {
      if (!cell?.isHeader) break;
      bodyDerived += Math.max(1, Number(cell.colspan || 1));
    }
    if (bodyDerived > 0 || sawAnyHeaderCells) {
      return Math.min(bodyDerived, sourceColumns.length);
    }
  }

  const topPlacements = topology.placements
    .filter((placement) => placement.rowIndex === 0)
    .sort((left, right) => left.startCol - right.startCol);
  let leadingCount = 0;
  for (const placement of topPlacements) {
    if (placement.startCol !== leadingCount) break;
    const isRowLevel = /^rowLevel\d+$/i.test(String(placement.cell.columnId || ''));
    const spansFullHeader =
      topology.headerRows.length > 1 &&
      placement.rowspan >= topology.headerRows.length;
    const isNonNumericFullHeightCell =
      spansFullHeader &&
      sourceColumns
        .slice(placement.startCol, placement.endCol + 1)
        .every((column) => !column?.isNumeric);
    if (!isRowLevel && !isNonNumericFullHeightCell) break;
    leadingCount += placement.colspan;
  }

  if (leadingCount === 0 && topPlacements.length > 0) {
    const firstPlacement = topPlacements[0];
    const looksLikeGroupedDimension =
      firstPlacement.colspan > 1 &&
      firstPlacement.rowspan < Math.max(1, topology.headerRows.length) &&
      topology.leafCells
        .slice(firstPlacement.startCol, firstPlacement.endCol + 1)
        .every((cell) => resolvePdfNumericSemantic(cell) !== true);
    if (looksLikeGroupedDimension) {
      return Math.min(firstPlacement.colspan, sourceColumns.length);
    }
  }

  return Math.min(leadingCount, sourceColumns.length);
}

/**
 * Build the authoritative PDF table model once. Both structured Fast PDF and
 * DOM-extracted inputs cross this same seam before fit or banded projection.
 * The returned projector is the only supported way to derive render sections.
 */
export function buildPdfTableModel(tableData = {}, options = {}) {
  const headers = Array.isArray(tableData.headers) ? tableData.headers : [];
  const rows = Array.isArray(tableData.rows) ? tableData.rows : [];
  const metadata = tableData.metadata || {};
  const topology = buildHeaderTopology(headers);
  const leafCount = Math.max(
    topology.leafCells.length,
    Number(metadata.totalColumns || 0),
    ...rows.map((row) => getExpandedCellCount(row?.cells || [])),
    tableData.grandTotal ? getExpandedCellCount(tableData.grandTotal.cells || []) : 0,
  );
  const physicalRows = normalizePhysicalRows(rows, leafCount);
  const physicalGrandTotal = normalizePhysicalTotal(tableData.grandTotal, leafCount);
  const columnsMeta = Array.isArray(metadata.columns) ? metadata.columns : [];

  const sourceColumns = Array.from({ length: leafCount }, (_, sourceIndex) => {
    const headerCell = topology.leafCells[sourceIndex] || normalizeHeaderCell();
    const bodyCell = physicalRows.find((row) => row[sourceIndex]?.columnId)?.[sourceIndex];
    const columnMeta = getColumnMeta(
      columnsMeta,
      headerCell.columnId || bodyCell?.columnId,
      sourceIndex,
    );
    const columnId =
      headerCell.columnId ||
      columnMeta?.columnId ||
      bodyCell?.columnId ||
      `col_${sourceIndex + 1}`;
    const label =
      normalizeCellText(headerCell.text) ||
      normalizeCellText(columnMeta?.label) ||
      `Column ${sourceIndex + 1}`;
    const sampleValues = physicalRows
      .slice(0, 50)
      .map((row) => row[sourceIndex]?.text ?? '');
    const totalValue = physicalGrandTotal?.[sourceIndex]?.text ?? '';
    const type = inferColumnType(headerCell, columnMeta, [...sampleValues, totalValue]);
    const typeMinWidthPx = getColumnWidthBounds(type).min;
    const measuredWidthPx = Number.isFinite(columnMeta?.measuredWidthPx)
      ? Number(columnMeta.measuredWidthPx)
      : Number.isFinite(headerCell.measuredWidthPx)
        ? Number(headerCell.measuredWidthPx)
        : null;
    const widthPx = estimateColumnWidthPx({
      type,
      label,
      sampleValues,
      grandTotalValue: totalValue,
      measuredWidthPx,
    });
    const minWidthPx = type === 'numeric' ? widthPx : typeMinWidthPx;

    return {
      index: sourceIndex,
      sourceIndex,
      columnId,
      label,
      type,
      minWidthPx,
      widthPx,
      isNumeric: type === 'numeric',
    };
  });
  const isPivotTable = isPivotTableMetadata(metadata);
  const pivotAnchorCount = resolvePivotAnchorCount(
    metadata,
    rows,
    topology,
    sourceColumns,
  );

  const shouldSuppressEmptyColumns =
    options.suppressEmptyColumns !== false &&
    String(metadata.tableType || '').toLowerCase() === 'data' &&
    (physicalRows.length > 0 || physicalGrandTotal);
  const keptSourceIndices = shouldSuppressEmptyColumns
    ? sourceColumns
        .filter((column) => {
          const sourceIndex = column.sourceIndex;
          return (
            physicalRows.some((row) => hasCellValue(row[sourceIndex])) ||
            hasCellValue(physicalGrandTotal?.[sourceIndex])
          );
        })
        .map((column) => column.sourceIndex)
    : sourceColumns.map((column) => column.sourceIndex);

  if (keptSourceIndices.length === 0 && sourceColumns.length > 0) {
    keptSourceIndices.push(sourceColumns[0].sourceIndex);
  }

  const keptSet = new Set(keptSourceIndices);
  const hiddenEmptyColumns = sourceColumns
    .filter((column) => !keptSet.has(column.sourceIndex))
    .map((column) => ({ columnId: column.columnId, label: column.label }));
  const columns = keptSourceIndices.map((sourceIndex, index) => ({
    ...sourceColumns[sourceIndex],
    index,
  }));
  const allModelIndices = columns.map((column) => column.index);
  const preservedBodySpansAvailable = hiddenEmptyColumns.length === 0;

  const project = (
    selectedModelIndices = allModelIndices,
    { preserveHeaderHierarchy = true, preserveBodySpans = false } = {},
  ) => {
    const selectedColumns = selectedModelIndices
      .map((index) => columns[index])
      .filter(Boolean);
    const sourceIndices = selectedColumns.map((column) => column.sourceIndex);
    const headersForProjection = preserveHeaderHierarchy
      ? projectHeaderTopology(topology, sourceIndices, selectedColumns)
      : null;
    const projectedRows =
      preserveBodySpans &&
      preservedBodySpansAvailable &&
      selectedColumns.length === columns.length
        ? normalizeRowsWithColumnSemantics(rows, sourceColumns)
        : rows.map((row, rowIndex) => ({
            ...row,
            cells: selectedColumns.map((column) =>
              applyResolvedColumnSemantics(
                clonePhysicalCell(physicalRows[rowIndex]?.[column.sourceIndex]),
                column,
              ),
            ),
          }));
    const projectedGrandTotal = physicalGrandTotal
      ? {
          ...(tableData.grandTotal || {}),
          cells: selectedColumns.map((column) =>
            applyResolvedColumnSemantics(
              clonePhysicalCell(physicalGrandTotal[column.sourceIndex]),
              column,
            ),
          ),
        }
      : null;

    return {
      headers: headersForProjection || buildFlatHeaders(selectedColumns),
      rows: projectedRows,
      grandTotal: projectedGrandTotal,
      columns: selectedColumns,
    };
  };

  return {
    columns,
    hiddenEmptyColumns,
    isPivotTable,
    pivotAnchorCount,
    project,
  };
}
