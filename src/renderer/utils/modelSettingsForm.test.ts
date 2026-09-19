import { describe, expect, it } from 'vitest';

import {
  parseContextWindowInput,
  isModalitySelectionValid,
  initialModalitySelection,
  resolveModalitiesToSave,
  discoveredModelWritePlan,
} from './modelSettingsForm';

describe('parseContextWindowInput', () => {
  it('empty input clears the override (null)', () => {
    expect(parseContextWindowInput('')).toBeNull();
    expect(parseContextWindowInput('   ')).toBeNull();
  });

  it('parses plain token counts', () => {
    expect(parseContextWindowInput('128000')).toBe(128_000);
    expect(parseContextWindowInput('1048576')).toBe(1_048_576);
  });

  it('parses k/m suffixes case-insensitively', () => {
    expect(parseContextWindowInput('128k')).toBe(128_000);
    expect(parseContextWindowInput('128K')).toBe(128_000);
    expect(parseContextWindowInput('1m')).toBe(1_000_000);
    expect(parseContextWindowInput('1M')).toBe(1_000_000);
    expect(parseContextWindowInput('1.5k')).toBe(1_500);
    expect(parseContextWindowInput('1.5m')).toBe(1_500_000);
    expect(parseContextWindowInput('128 k')).toBe(128_000);
  });

  it('rejects garbage, non-integers, zero, and absurd values', () => {
    expect(parseContextWindowInput('abc')).toBe('invalid');
    expect(parseContextWindowInput('-1')).toBe('invalid');
    expect(parseContextWindowInput('1.5')).toBe('invalid');   // fractional tokens
    expect(parseContextWindowInput('0')).toBe('invalid');
    expect(parseContextWindowInput('1e6')).toBe('invalid');
    expect(parseContextWindowInput('128kb')).toBe('invalid');
  });

  it('caps at the sidecar registry bound (MAX_PLAUSIBLE_TOKENS = 20M)', () => {
    // Values the registry would silently drop must be rejected at input time,
    // otherwise the renderer saves a number the runtime ignores.
    expect(parseContextWindowInput('20m')).toBe(20_000_000);  // at the cap — ok
    expect(parseContextWindowInput('50m')).toBe('invalid');
    expect(parseContextWindowInput('20000001')).toBe('invalid');
  });
});

describe('isModalitySelectionValid', () => {
  it('requires at least one modality', () => {
    expect(isModalitySelectionValid([])).toBe(false);
    expect(isModalitySelectionValid(['text'])).toBe(true);
    expect(isModalitySelectionValid(['image'])).toBe(true);
  });
});

describe('initialModalitySelection', () => {
  it('defaults to text-checked when nothing is recorded', () => {
    expect(initialModalitySelection(undefined)).toEqual(['text']);
    expect(initialModalitySelection([])).toEqual(['text']);
  });

  it('prefills the stored list, preserving canonical order and dropping unknown kinds', () => {
    expect(initialModalitySelection(['image', 'text'])).toEqual(['text', 'image']);
    expect(initialModalitySelection(['text', 'document'])).toEqual(['text']);
  });
});

describe('resolveModalitiesToSave', () => {
  it('keeps an unset model unset when the user never touched the toggles', () => {
    // Saving an untouched editor must NOT narrow optimistic default-allow
    // (unset) down to ['text'] — that would silently block image attachments.
    expect(resolveModalitiesToSave(false, undefined, ['text'])).toBeUndefined();
    expect(resolveModalitiesToSave(false, [], ['text'])).toBeUndefined();
  });

  it('persists the explicit selection once touched', () => {
    expect(resolveModalitiesToSave(true, undefined, ['text', 'image'])).toEqual(['text', 'image']);
  });

  it('persists for models that already had an explicit list, even untouched', () => {
    expect(resolveModalitiesToSave(false, ['text', 'image'], ['text', 'image'])).toEqual(['text', 'image']);
  });

  it('preserves modalities the editor cannot render (open value space)', () => {
    // Regression (cross-review 0.2.33, cc): the editor only shows the four
    // EDITABLE_MODALITIES toggles, but the registry stores an open set
    // (LiteLLM records `pdf` / `document`). Saving must merge the invisible
    // extras back, not replace them away — losing `pdf` here makes the
    // sidecar's modelSupportsModality start rejecting PDF attachments the
    // model actually supports.
    expect(
      resolveModalitiesToSave(true, ['text', 'pdf'], ['text', 'image']),
    ).toEqual(['text', 'image', 'pdf']);
    // Untouched save of an explicit list round-trips the extras too.
    expect(
      resolveModalitiesToSave(false, ['text', 'document'], ['text']),
    ).toEqual(['text', 'document']);
  });
});

describe('discoveredModelWritePlan — re-adding a removed bundled preset (cross-review 0.2.32, codex)', () => {
  const bundled = new Set(['claude-fable-5', 'claude-haiku-4-5']);

  it('bundled id from discovery: un-remove only, never append discovered metadata into presetCustomModels', () => {
    // Regression: handleAddDiscoveredModel used to ALSO append the discovered
    // entity into presetCustomModels. Discovery metadata is lower-trust than
    // curated bundled data, so the discovered row should only restore the
    // bundled preset. Manual typed entries use source: 'manual' and are tested
    // separately in shared config merge tests.
    expect(discoveredModelWritePlan(bundled, 'claude-fable-5')).toEqual({
      unremove: true,
      appendToCustomModels: false,
    });
  });

  it('non-bundled discovered id keeps today\'s behavior (append as user-added custom model)', () => {
    expect(discoveredModelWritePlan(bundled, 'my-org/custom-model')).toEqual({
      unremove: true,
      appendToCustomModels: true,
    });
  });
});
