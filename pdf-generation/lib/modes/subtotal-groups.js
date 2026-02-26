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
