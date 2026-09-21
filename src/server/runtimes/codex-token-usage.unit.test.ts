import { describe, it, expect } from 'vitest';

import { addCodexExactResponseUsage, mapCodexTokenUsage } from './codex-token-usage';
import { computeContextUsage } from '../../shared/contextUsage';

// Realistic payload shape from `codex app-server generate-ts` (v0.136.0):
//   thread/tokenUsage/updated → { threadId, turnId, tokenUsage: ThreadTokenUsage }
//   ThreadTokenUsage    = { total, last, modelContextWindow }
//   TokenUsageBreakdown = { totalTokens, inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens }
function breakdown(input: number, cached: number, output = 0, cacheWrite = 0) {
  return {
    totalTokens: input + output,
    inputTokens: input,
    cachedInputTokens: cached,
    cacheWriteInputTokens: cacheWrite,
    outputTokens: output,
    reasoningOutputTokens: 0,
  };
}

describe('mapCodexTokenUsage', () => {
  it('occupancy uses last.inputTokens, NOT the running total', () => {
    const mapped = mapCodexTokenUsage({
      total: breakdown(500_000, 0, 12_000), // cumulative across the whole turn — would massively overestimate
      last: breakdown(82_200, 40_000),       // most recent call: this is the real occupancy
      modelContextWindow: 272_000,
    });
    expect(mapped).not.toBeNull();
    // occupancy = last.inputTokens (82.2K), NOT total (500K)
    expect(mapped!.contextOccupiedTokens).toBe(82_200);
    // running totals preserved for the watchdog
    expect(mapped!.runningTotalInputTokens).toBe(500_000);
    expect(mapped!.runningTotalOutputTokens).toBe(12_000);
    expect(mapped!.runtimeContextWindow).toBe(272_000);
  });

  it('does NOT add cachedInputTokens to occupancy (OpenAI 系 inputTokens already includes cached)', () => {
    const mapped = mapCodexTokenUsage({
      total: breakdown(200_000, 0),
      last: breakdown(80_000, 50_000), // inputTokens already includes the 50K cached → occupancy is 80K, not 130K
      modelContextWindow: 200_000,
    });
    expect(mapped!.contextOccupiedTokens).toBe(80_000);
  });

  it('does not expose cumulative cache totals as a per-turn fallback baseline', () => {
    const mapped = mapCodexTokenUsage({
      total: breakdown(200_000, 70_000, 3_000, 12_000),
      last: breakdown(80_000, 40_000, 1_000, 2_000),
      modelContextWindow: 272_000,
    });
    expect(mapped).not.toHaveProperty('runningTotalCacheReadTokens');
    expect(mapped).not.toHaveProperty('runningTotalCacheCreationTokens');
  });

  it('returns null modelContextWindow when the runtime does not report one', () => {
    const mapped = mapCodexTokenUsage({ total: breakdown(100, 0), last: breakdown(100, 0), modelContextWindow: null });
    expect(mapped!.runtimeContextWindow).toBeNull();
  });

  it('returns undefined occupancy when last is missing (lets downstream fall back)', () => {
    const mapped = mapCodexTokenUsage({ total: breakdown(100, 0), modelContextWindow: 200_000 });
    expect(mapped!.contextOccupiedTokens).toBeUndefined();
  });

  it('returns null for a payload with no total (malformed)', () => {
    expect(mapCodexTokenUsage(undefined)).toBeNull();
    expect(mapCodexTokenUsage({})).toBeNull();
    expect(mapCodexTokenUsage(null)).toBeNull();
  });

  it('end-to-end: Codex occupancy + runtime window → correct usedPercent', () => {
    const mapped = mapCodexTokenUsage({
      total: breakdown(999_999, 0),
      last: breakdown(136_000, 60_000),
      modelContextWindow: 272_000,
    })!;
    const usage = computeContextUsage({
      occupiedTokens: mapped.contextOccupiedTokens!,
      runtimeWindow: mapped.runtimeContextWindow,
      source: 'codex',
      model: 'gpt-5.4-codex',
      lookupWindow: () => null,
    });
    expect(usage.contextWindow).toBe(272_000);
    expect(usage.windowSource).toBe('runtime');
    expect(usage.usedPercent).toBeCloseTo(50, 5); // 136K / 272K
    expect(usage.source).toBe('codex');
  });
});

describe('addCodexExactResponseUsage', () => {
  it('sums exact per-response provider usage including cache writes', () => {
    const first = addCodexExactResponseUsage(null, breakdown(100, 40, 20, 10));
    const total = addCodexExactResponseUsage(first, breakdown(80, 30, 15, 5));
    expect(total).toEqual({
      inputTokens: 180,
      outputTokens: 35,
      cacheReadTokens: 70,
      cacheCreationTokens: 15,
    });
  });

  it('rejects incomplete provider usage instead of persisting a partial exact total', () => {
    expect(addCodexExactResponseUsage(null, {
      inputTokens: Number.NaN,
      outputTokens: -1,
      cachedInputTokens: 5,
    })).toBeNull();
  });
});

// Cache hit rate must come from the most recent call. Using `total` would make
// the rate climb toward 100% on any long turn regardless of real reuse.
describe('mapCodexTokenUsage cache split', () => {
  it('splits last.inputTokens into cached and fresh', () => {
    const mapped = mapCodexTokenUsage({
      total: breakdown(500_000, 400_000, 12_000),
      last: breakdown(80_000, 50_000),
    });

    // OpenAI-family semantics: inputTokens already includes cached, so fresh is
    // the remainder rather than a separate bucket.
    expect(mapped?.cacheReadTokens).toBe(50_000);
    expect(mapped?.freshInputTokens).toBe(30_000);
  });

  it('omits the split when the runtime does not report cached tokens', () => {
    const mapped = mapCodexTokenUsage({
      total: breakdown(500_000, 0, 12_000),
      last: { inputTokens: 80_000 },
    });

    // Absent, not zero — "unknown" and "0% hit" are different, and showing 0%
    // would send the user chasing a cache problem that does not exist.
    expect(mapped?.cacheReadTokens).toBeUndefined();
    expect(mapped?.freshInputTokens).toBeUndefined();
  });

  it('a fully cached prompt reports zero fresh input rather than dropping the split', () => {
    const mapped = mapCodexTokenUsage({
      total: breakdown(100_000, 100_000),
      last: breakdown(100_000, 100_000),
    });

    expect(mapped?.cacheReadTokens).toBe(100_000);
    expect(mapped?.freshInputTokens).toBe(0);
  });

  it('never reports more cached tokens than the prompt itself', () => {
    // A malformed payload must not produce negative fresh input.
    const mapped = mapCodexTokenUsage({
      total: breakdown(1_000, 0),
      last: breakdown(1_000, 5_000),
    });

    expect(mapped?.cacheReadTokens).toBe(1_000);
    expect(mapped?.freshInputTokens).toBe(0);
  });
});
