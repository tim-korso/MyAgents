import { describe, it, expect } from 'vitest';
import type { CronEndConditions } from '@/types/cronTask';
import { deriveInitialEndMode } from './cronEndMode';

describe('deriveInitialEndMode', () => {
  it('defaults to forever when there are no end conditions', () => {
    expect(deriveInitialEndMode(undefined)).toBe('forever');
    expect(deriveInitialEndMode(null)).toBe('forever');
    expect(deriveInitialEndMode({ aiCanExit: false })).toBe('forever');
  });

  it('treats aiCanExit-only as 永久运行 (forever), not 条件停止', () => {
    // Regression: this is the /loop preset shape, and also what
    // handleConfirm's forever branch emits ({ aiCanExit: true }). It must
    // round-trip back to 'forever' so the toggle matches what was saved.
    expect(deriveInitialEndMode({ aiCanExit: true })).toBe('forever');
  });

  it('treats a deadline as 条件停止 (conditional)', () => {
    expect(deriveInitialEndMode({ deadline: '2026-06-08T00:00:00Z', aiCanExit: false })).toBe('conditional');
  });

  it('treats a max-execution count as 条件停止 (conditional)', () => {
    expect(deriveInitialEndMode({ maxExecutions: 10, aiCanExit: false })).toBe('conditional');
    // 0 is a real value (!= null), still conditional
    expect(deriveInitialEndMode({ maxExecutions: 0, aiCanExit: false })).toBe('conditional');
  });

  it('stays conditional when a real stop condition coexists with aiCanExit', () => {
    const ec: CronEndConditions = { maxExecutions: 5, aiCanExit: true };
    expect(deriveInitialEndMode(ec)).toBe('conditional');
  });
});
