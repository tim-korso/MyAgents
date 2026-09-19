import { describe, expect, it } from 'vitest';
import { tableGeometry } from './tableGeometry';

describe('sparse table geometry', () => {
  it('matches measured row boundaries and spacer heights', () => {
    const heights = new Map([[0, 42], [3, 80], [7, 26]]);
    const geometry = tableGeometry(10, heights);
    let total = 0;
    for (let row = 0; row < 10; row++) {
      expect(geometry.offset(row)).toBe(total);
      expect(geometry.rowAt(total)).toBe(row);
      total += heights.get(row) ?? 35;
    }
    expect(geometry.offset(10)).toBe(total);
    expect(geometry.rowAt(total + 100)).toBe(10);
    expect(geometry.rowAt(-10)).toBe(0);
  });
  it('handles huge tables from only mounted measurements, ignoring removed rows', () => {
    const geometry = tableGeometry(1_000_000, new Map([[10, 70], [999_999, 50], [1_000_000, 999]]));
    expect(geometry.offset(999_999)).toBe(999_999 * 35 + 35);
    expect(geometry.offset(1_000_000)).toBe(35_000_050);
    expect(geometry.rowAt(900_000 * 35 + 35)).toBe(900_000);
  });
});
