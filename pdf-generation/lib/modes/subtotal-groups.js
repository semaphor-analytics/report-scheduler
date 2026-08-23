export function groupRowsBySubtotal(rows = []) {
  const groups = [];
  let currentGroup = [];

  rows.forEach((row) => {
    currentGroup.push(row);

    if (row?.type === 'subtotal') {
      groups.push(currentGroup);
      currentGroup = [];
    }
  });

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

const SUBTOTAL_CONTEXT_ROWS = 2;

function rowSpansAcrossSplit(group = [], splitIndex = 0) {
  if (!Array.isArray(group) || splitIndex <= 0) {
    return false;
  }

  for (let rowIndex = 0; rowIndex < splitIndex; rowIndex += 1) {
    const row = group[rowIndex];
    const spansBoundary = (row?.cells || []).some((cell) => {
      const rowspan = Math.max(1, Number(cell?.rowspan || 1));
      return rowIndex + rowspan > splitIndex;
    });

    if (spansBoundary) {
      return true;
    }
  }

  return false;
}

/**
 * Keep the subtotal with a small amount of preceding detail context without
 * making an entire large group non-breaking. Large non-breaking tbody blocks
 * can move the first table row to a new page and leave the report header on an
 * otherwise empty page.
 */
export function splitSubtotalGroupForPagination(group = []) {
  if (!Array.isArray(group) || group.length === 0) {
    return [];
  }

  const lastRow = group[group.length - 1];
  if (lastRow?.type !== 'subtotal') {
    return [{ className: 'group', rows: group }];
  }

  const detailRows = group.slice(0, -1);
  const protectedDetailCount = Math.min(SUBTOTAL_CONTEXT_ROWS, detailRows.length);
  const splitIndex = detailRows.length - protectedDetailCount;

  if (splitIndex <= 0) {
    return [{ className: 'group subtotal-tail', rows: group }];
  }

  if (rowSpansAcrossSplit(group, splitIndex)) {
    // Splitting this group into separate tbody blocks would invalidate the
    // authored rowspan. Keep one tbody, but do not make the complete group
    // non-breaking: that recreates the mostly empty first-page regression for
    // groups taller than the remaining printable area.
    return [{ className: 'group', rows: group }];
  }

  return [
    { className: 'group', rows: group.slice(0, splitIndex) },
    { className: 'group subtotal-tail', rows: group.slice(splitIndex) },
  ];
}
