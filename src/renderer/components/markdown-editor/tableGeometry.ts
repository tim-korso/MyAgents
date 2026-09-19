/** Sparse measured corrections to the default row height. A million-row table
 * must not allocate/rebuild a million offsets when thirty visible rows resize. */
export function tableGeometry(rowCount: number, heights: ReadonlyMap<number, number>) {
  const rows = [...heights.keys()].filter(row => row >= 0 && row < rowCount).sort((a, b) => a - b);
  const corrections = [0];
  for (const row of rows) corrections.push(corrections[corrections.length - 1] + heights.get(row)! - 35);
  const offset = (row: number) => {
    let low = 0, high = rows.length;
    while (low < high) { const mid = (low + high) >>> 1; if (rows[mid] < row) low = mid + 1; else high = mid; }
    return row * 35 + corrections[low];
  };
  const rowAt = (position: number) => {
    let low = 0, high = rowCount;
    while (low < high) { const mid = (low + high) >>> 1; if (offset(mid) < position) low = mid + 1; else high = mid; }
    return low;
  };
  return { offset, rowAt };
}
