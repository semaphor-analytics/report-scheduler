/**
 * Body segments for rows that carry the shared Matrix keep plan (Plan 2, 2d,
 * C4): a row marked `keepWithPrevious` joins the segment of the row before
 * it. A segment of kept rows prints as one tbody that does not break inside,
 * so a total never starts a page, a header row never ends one, and a group's
 * first row is never alone at the bottom. Other rows share tbodies that
 * break freely. Returns null for rows without the plan.
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
