const CSS_DPI = 96;
const MM_PER_INCH = 25.4;

export const TABLE_PAGE_GEOMETRY = Object.freeze({
  marginsMm: Object.freeze({
    top: 8,
    right: 10,
    bottom: 12,
    left: 10,
  }),
  printBodyPaddingMm: 0,
});

function toCssMillimeters(value) {
  return value === 0 ? '0' : `${value}mm`;
}

export function getTablePdfMargins() {
  const { top, right, bottom, left } = TABLE_PAGE_GEOMETRY.marginsMm;
  return {
    top: toCssMillimeters(top),
    right: toCssMillimeters(right),
    bottom: toCssMillimeters(bottom),
    left: toCssMillimeters(left),
  };
}

export function getTablePrintBodyPaddingCss() {
  return toCssMillimeters(TABLE_PAGE_GEOMETRY.printBodyPaddingMm);
}

export function getTableHorizontalInsetPx() {
  const { left, right } = TABLE_PAGE_GEOMETRY.marginsMm;
  const totalInsetMm = left + right + (TABLE_PAGE_GEOMETRY.printBodyPaddingMm * 2);
  return (totalInsetMm / MM_PER_INCH) * CSS_DPI;
}
