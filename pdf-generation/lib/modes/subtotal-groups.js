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

/**
 * Body segments for rows that carry the shared Matrix keep plan (Plan 2, 2d,
 * C4): a row marked `keepWithPrevious` joins the segment of the row before
 * it. A segment of kept rows prints as one tbody that does not break inside,
 * so a total never starts a page, a header row never ends one, and a group's
 * first row is never alone at the bottom. Other rows share tbodies that
 * break freely. Returns null for rows without the plan (Tables, legacy Pivot),
 * which keep their subtotal grouping.
 */
export function segmentRowsByKeepPlan(rows = []) {
  if (!rows.some((row) => typeof row?.keepWithPrevious === 'boolean')) {
    return null;
  }

  const chains = [];
  rows.forEach((row, index) => {
    if (index > 0 && row?.keepWithPrevious === true) {
      chains[chains.length - 1].push(row);
    } else {
      chains.push([row]);
    }
  });

  // Rows that keep with nothing share one freely breaking segment.
  const segments = [];
  for (const chain of chains) {
    const kept = chain.length > 1;
    const previous = segments[segments.length - 1];
    if (!kept && previous && !previous.kept) {
      previous.rows.push(...chain);
    } else {
      segments.push({ rows: chain, kept });
    }
  }

  return segments.map((segment) => ({
    className: segment.kept ? 'group keep-together' : 'group',
    rows: segment.rows,
  }));
}
