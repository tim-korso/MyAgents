import { describe, expect, it } from 'vitest';

import { type CellRange, clampSheetRange } from './sheetMetrics';

const range = (sr: number, sc: number, er: number, ec: number): CellRange => ({
  s: { r: sr, c: sc },
  e: { r: er, c: ec },
});

describe('clampSheetRange', () => {
  it('leaves a small sheet untouched', () => {
    const res = clampSheetRange(range(0, 0, 9, 9), 2000, 100);
    expect(res.truncated).toBe(false);
    expect(res.range).toEqual(range(0, 0, 9, 9));
  });

  it('truncates rows beyond maxRows, keeping exactly maxRows from the start', () => {
    const res = clampSheetRange(range(0, 0, 4999, 5), 2000, 100);
    expect(res.truncated).toBe(true);
    expect(res.range.e.r).toBe(1999); // s.r + 2000 - 1
    expect(res.range.e.c).toBe(5); // cols within cap, unchanged
  });

  it('truncates cols beyond maxCols', () => {
    const res = clampSheetRange(range(0, 0, 10, 500), 2000, 100);
    expect(res.truncated).toBe(true);
    expect(res.range.e.c).toBe(99); // s.c + 100 - 1
    expect(res.range.e.r).toBe(10);
  });

  it('uses an inclusive boundary: exactly maxRows rows is NOT truncated', () => {
    expect(clampSheetRange(range(0, 0, 1999, 0), 2000, 100).truncated).toBe(false); // 2000 rows
    expect(clampSheetRange(range(0, 0, 2000, 0), 2000, 100).truncated).toBe(true); // 2001 rows
  });

  it('clamps relative to a non-zero start row', () => {
    const res = clampSheetRange(range(10, 2, 9000, 2), 2000, 100);
    expect(res.range.e.r).toBe(10 + 2000 - 1); // 2009
    expect(res.range.s).toEqual({ r: 10, c: 2 }); // start preserved
  });
});
