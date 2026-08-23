import { normalizePageSize } from '../page-size-utils.js';
import { buildPdfTableModel } from './table-column-semantics.js';
import { getColumnWidthBounds } from './table-column-widths.js';
import { getTableHorizontalInsetPx } from './table-page-geometry.js';

const DPI = 96;

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
const WIDE_TABLE_STRATEGIES = new Set([
  'auto',
  'fit',
  'horizontal_paginate',
]);

function normalizeCellText(value) {
  if (value === null || value === undefined) return '';
  return String(value);
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
  const safety = 8;
  return Math.max(200, dims.width - getTableHorizontalInsetPx() - safety);
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

function sumColumnWidths(columns, widthKey = 'widthPx') {
  return columns.reduce(
    (sum, column) => sum + (Number(column?.[widthKey]) || 0),
    0,
  );
}

function allocateFitColumnWidths(columns, printableWidthPx) {
  const preferredWidthPx = sumColumnWidths(columns);
  if (preferredWidthPx <= printableWidthPx) {
    return columns.map((column) => column.widthPx);
  }

  const minimumWidthPx = sumColumnWidths(columns, 'minWidthPx');
  if (minimumWidthPx >= printableWidthPx) {
    return columns.map((column) => column.minWidthPx);
  }

  const shrinkNeededPx = preferredWidthPx - printableWidthPx;
  const shrinkCapacityPx = preferredWidthPx - minimumWidthPx;
  return columns.map((column) => {
    const capacityPx = Math.max(0, column.widthPx - column.minWidthPx);
    const shrinkPx = shrinkNeededPx * (capacityPx / shrinkCapacityPx);
    return Math.max(column.minWidthPx, column.widthPx - shrinkPx);
  });
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

function buildBands(columns, printableWidthPx, pivotAnchorCount = 0) {
  const minDynamicWidth = getColumnWidthBounds('text').min;
  const preservePivotAnchors = pivotAnchorCount > 0;
  const configuredPivotAnchorIndices = preservePivotAnchors
    ? columns.slice(0, pivotAnchorCount).map((column) => column.index)
    : [];
  let anchorIndices = preservePivotAnchors
    ? [...configuredPivotAnchorIndices]
    : selectAnchorColumns(columns, printableWidthPx);
  const getAnchorWidth = (indices) =>
    indices.reduce((sum, index) => sum + (columns[index]?.widthPx || 0), 0);
  const buildDynamicIndices = () =>
    columns
      .map((column) => column.index)
      .filter((index) => {
        if (anchorIndices.includes(index)) {
          return false;
        }
        if (preservePivotAnchors && configuredPivotAnchorIndices.includes(index)) {
          return false;
        }
        return true;
      });
  let dynamicIndices = buildDynamicIndices();

  if (dynamicIndices.length > 0) {
    let anchorWidth = getAnchorWidth(anchorIndices);
    if (preservePivotAnchors) {
      while (
        anchorIndices.length > 1 &&
        printableWidthPx - anchorWidth < minDynamicWidth
      ) {
        anchorIndices = anchorIndices.slice(0, -1);
        anchorWidth = getAnchorWidth(anchorIndices);
      }
    }
    // If anchors consume too much horizontal budget, trim trailing anchors to keep
    // at least one reasonably readable dynamic column in each band.
    while (
      !preservePivotAnchors &&
      anchorIndices.length > 0 &&
      printableWidthPx - anchorWidth < minDynamicWidth
    ) {
      anchorIndices = anchorIndices.slice(0, -1);
      anchorWidth = getAnchorWidth(anchorIndices);
    }
    dynamicIndices = buildDynamicIndices();
  }

  const anchorWidth = getAnchorWidth(anchorIndices);
  const availableForDynamic = Math.max(40, printableWidthPx - anchorWidth);
  const dynamicWidthByIndex = {};

  const bands = [];
  let current = [];
  let currentWidth = 0;

  dynamicIndices.forEach((index) => {
    const rawWidth = columns[index]?.widthPx || getColumnWidthBounds('text').min;
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
    bands,
    dynamicWidthByIndex,
  };
}

function formatSelectedColumnRanges(selectedIndices = [], totalColumns = 0) {
  const sorted = [...new Set(selectedIndices)]
    .filter((index) => Number.isInteger(index) && index >= 0)
    .sort((a, b) => a - b);

  if (sorted.length === 0) {
    const fallbackTotal = Math.max(1, Number(totalColumns) || 1);
    return `Columns 1-${fallbackTotal} of ${fallbackTotal}`;
  }

  const ranges = [];
  let rangeStart = sorted[0];
  let previous = sorted[0];

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    if (current === previous + 1) {
      previous = current;
      continue;
    }

    ranges.push(rangeStart === previous ? `${rangeStart + 1}` : `${rangeStart + 1}-${previous + 1}`);
    rangeStart = current;
    previous = current;
  }

  ranges.push(rangeStart === previous ? `${rangeStart + 1}` : `${rangeStart + 1}-${previous + 1}`);

  return `Columns ${ranges.join(', ')} of ${Math.max(1, Number(totalColumns) || 1)}`;
}

function buildBandColumnDescriptors(
  columns,
  selectedIndices,
  widthOverridesByIndex = {},
) {
  return selectedIndices.map((index) => {
    const column = columns[index];
    const overrideWidth = Number(widthOverridesByIndex[index]);
    const widthPx =
      Number.isFinite(overrideWidth) && overrideWidth > 0
        ? overrideWidth
        : column.widthPx;
    return {
      columnId: column.columnId,
      label: column.label,
      widthPx,
      isNumeric: column.isNumeric,
      sourceIndex: index,
    };
  });
}

export function buildWideTableLayout(tableData, options = {}) {
  const requestedPageSize = normalizePageSize(options.pageSize || 'Letter');
  const requestedOrientation = normalizeOrientation(options.orientation || 'portrait');
  const requestedStrategy = String(options.wideTableStrategy || 'auto');
  const strategy = WIDE_TABLE_STRATEGIES.has(requestedStrategy)
    ? requestedStrategy
    : 'auto';

  const tableModel = buildPdfTableModel(tableData, options);
  const {
    columns,
    hiddenEmptyColumns,
    isPivotTable,
    pivotAnchorCount,
  } = tableModel;
  const minimumRequiredWidthPx = sumColumnWidths(columns, 'minWidthPx');
  const candidates = buildCandidateLayouts(requestedPageSize, requestedOrientation);
  let chosen = candidates.find(
    (candidate) => minimumRequiredWidthPx <= candidate.printableWidthPx,
  );

  if (strategy === 'fit' && !chosen) {
    chosen = getWidestCandidate(candidates);
  }

  if (chosen && strategy !== 'horizontal_paginate') {
    const fitWidths = allocateFitColumnWidths(columns, chosen.printableWidthPx);
    const selectedIndices = columns.map((column) => column.index);
    const hasSuppressedColumns = hiddenEmptyColumns.length > 0;
    const projection = tableModel.project(selectedIndices, {
      preserveHeaderHierarchy: !hasSuppressedColumns,
      preserveBodySpans: !hasSuppressedColumns,
    });

    return {
      sections: [
        {
          headers: projection.headers,
          rows: projection.rows,
          grandTotal: projection.grandTotal,
          bandLabel: null,
          columns: columns.map((column, index) => ({
            columnId: column.columnId,
            label: column.label,
            widthPx: fitWidths[index],
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
  const bandingPlan = buildBands(
    columns,
    fallback.printableWidthPx,
    pivotAnchorCount,
  );
  const anchorLabels = bandingPlan.anchorIndices.map((index) => columns[index]?.label).filter(Boolean);
  const sections = bandingPlan.bands.map((dynamicIndices, bandIndex) => {
    const selectedIndices = [...bandingPlan.anchorIndices, ...dynamicIndices];
    const descriptors = buildBandColumnDescriptors(
      columns,
      selectedIndices,
      bandingPlan.dynamicWidthByIndex,
    );
    const projection = tableModel.project(selectedIndices, {
      preserveHeaderHierarchy: isPivotTable,
      preserveBodySpans: false,
    });

    const bandLabel = formatSelectedColumnRanges(selectedIndices, columns.length);

    return {
      headers: projection.headers,
      rows: projection.rows,
      grandTotal: projection.grandTotal,
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
