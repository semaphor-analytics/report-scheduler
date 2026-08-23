// Bounds are calibrated for the shared 11pt table density and include cell
// padding. They keep compact fields useful without allowing one value to
// dictate the width of every page or column band.
const WIDTH_BOUNDS_PX = Object.freeze({
  boolean: Object.freeze({ min: 52, max: 80 }),
  numeric: Object.freeze({ min: 56, max: 184 }),
  datetime: Object.freeze({ min: 82, max: 184 }),
  id: Object.freeze({ min: 72, max: 224 }),
  text: Object.freeze({ min: 76, max: 280 }),
});

const TEXT_METRICS = Object.freeze({
  averageGlyphPx: 7.4,
  horizontalPaddingPx: 18,
  measuredWidthHeadroom: 1.2,
  representativePercentile: 0.9,
});

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function getGlyphUnits(value) {
  return Array.from(normalizeText(value)).reduce((total, character) => {
    if (/[ilI1.,'|]/.test(character)) return total + 0.5;
    if (/[MW@%&#]/.test(character)) return total + 1.25;
    if (/\s/.test(character)) return total + 0.55;
    return total + 1;
  }, 0);
}

function estimateSingleLineWidthPx(value) {
  return (
    getGlyphUnits(value) * TEXT_METRICS.averageGlyphPx +
    TEXT_METRICS.horizontalPaddingPx
  );
}

function estimateHeaderWidthPx(label) {
  const text = normalizeText(label);
  if (!text) return 0;
  const tokens = text.split(/\s+/).filter(Boolean);
  const longestTokenWidth = tokens.reduce(
    (widest, token) => Math.max(widest, estimateSingleLineWidthPx(token)),
    0,
  );
  const compactTwoLineTarget = estimateSingleLineWidthPx(text) * 0.72;
  return Math.max(longestTokenWidth, compactTwoLineTarget);
}

function getPercentile(values, percentile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(0, Math.ceil(percentile * sorted.length) - 1);
  return sorted[Math.min(rank, sorted.length - 1)];
}

function getRepresentativeContentWidthPx(type, values) {
  const widths = values
    .map(normalizeText)
    .filter(Boolean)
    .map(estimateSingleLineWidthPx);
  if (widths.length === 0) return 0;

  if (type === 'numeric' || type === 'boolean') {
    return Math.max(...widths);
  }

  // Frequent wide text should influence layout; an isolated outlier should
  // wrap inside the column instead of widening the whole report.
  return getPercentile(widths, TEXT_METRICS.representativePercentile);
}

export function getColumnWidthBounds(type) {
  return WIDTH_BOUNDS_PX[type] || WIDTH_BOUNDS_PX.text;
}

export function estimateColumnWidthPx({
  type = 'text',
  label = '',
  sampleValues = [],
  grandTotalValue = '',
  measuredWidthPx = null,
} = {}) {
  const bounds = getColumnWidthBounds(type);
  const values = [...sampleValues, grandTotalValue];
  const contentTarget = Math.max(
    bounds.min,
    estimateHeaderWidthPx(label),
    getRepresentativeContentWidthPx(type, values),
  );
  const measured = Number(measuredWidthPx);
  const hasContent = values.some((value) => normalizeText(value));
  const boundedMeasured =
    Number.isFinite(measured) && measured > 0
      ? hasContent
        ? Math.min(measured, contentTarget * TEXT_METRICS.measuredWidthHeadroom)
        : measured
      : 0;
  const preferred = Math.max(contentTarget, boundedMeasured);

  return Math.min(bounds.max, Math.max(bounds.min, preferred));
}
