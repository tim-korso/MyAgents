import { describe, expect, it } from 'vitest';

import {
  clampDpr,
  deviceCanvasSize,
  estimatedPageHeight,
  fitScale,
  MAX_DPR,
  MIN_PAGE_WIDTH,
  pageContainerWidth,
} from './pdfMetrics';

describe('pageContainerWidth', () => {
  it('subtracts horizontal padding from the scroller width', () => {
    expect(pageContainerWidth(832)).toBe(800); // 832 - 32
  });
  it('floors at MIN_PAGE_WIDTH for narrow / zero / negative scrollers', () => {
    expect(pageContainerWidth(300)).toBe(MIN_PAGE_WIDTH);
    expect(pageContainerWidth(0)).toBe(MIN_PAGE_WIDTH);
    expect(pageContainerWidth(-100)).toBe(MIN_PAGE_WIDTH);
  });
});

describe('clampDpr', () => {
  it('caps at MAX_DPR (retina 3× → 2×)', () => {
    expect(clampDpr(3)).toBe(MAX_DPR);
    expect(clampDpr(2)).toBe(2);
    expect(clampDpr(1.5)).toBe(1.5);
  });
  it('treats falsy / missing DPR as 1 (pdf.js v5 does not auto-apply DPR)', () => {
    expect(clampDpr(0)).toBe(1);
    expect(clampDpr(undefined)).toBe(1);
    expect(clampDpr(null)).toBe(1);
    expect(clampDpr(Number.NaN)).toBe(1);
  });
});

describe('fitScale', () => {
  it('scales a native-width page to the container width', () => {
    expect(fitScale(800, 400)).toBe(2); // 2× to fill
    expect(fitScale(300, 600)).toBe(0.5); // shrink to fit
  });
});

describe('estimatedPageHeight', () => {
  it('preserves the page aspect ratio, rounded', () => {
    // A4-ish portrait 595×842 fit to width 800 → 800 * 842/595 ≈ 1132.
    expect(estimatedPageHeight(800, 595, 842)).toBe(1132);
    // Square page → equal height.
    expect(estimatedPageHeight(500, 100, 100)).toBe(500);
  });
});

describe('deviceCanvasSize', () => {
  it('scales the backing store by DPR and floors to integer pixels', () => {
    expect(deviceCanvasSize(800, 1000, 2)).toEqual({ width: 1600, height: 2000 });
    expect(deviceCanvasSize(800, 1000, 1)).toEqual({ width: 800, height: 1000 });
    // Non-integer product floors (canvas dims must be integers).
    expect(deviceCanvasSize(100.6, 50.9, 1)).toEqual({ width: 100, height: 50 });
  });
});
