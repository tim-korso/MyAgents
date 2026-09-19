import { describe, it, expect } from 'vitest';

import {
  coerceReasoningEffortForRuntime,
  coerceReasoningEffortSettingForRuntime,
  normalizeReasoningEffort,
  isSdkEffortLevel,
  reasoningEffortChoices,
  reasoningEffortAfterModelChange,
  SDK_EFFORT_LEVELS,
  OPENAI_EFFORT_LEVELS,
  CODEX_EFFORT_LEVELS,
  REASONING_EFFORT_DEFAULT,
} from './reasoningEffort';

describe('normalizeReasoningEffort (#324)', () => {
  it("collapses 'default' / empty / whitespace / nullish to undefined", () => {
    expect(normalizeReasoningEffort(REASONING_EFFORT_DEFAULT)).toBeUndefined();
    expect(normalizeReasoningEffort('')).toBeUndefined();
    expect(normalizeReasoningEffort('   ')).toBeUndefined();
    expect(normalizeReasoningEffort(null)).toBeUndefined();
    expect(normalizeReasoningEffort(undefined)).toBeUndefined();
  });
  it('passes levels through trimmed', () => {
    expect(normalizeReasoningEffort('max')).toBe('max');
    expect(normalizeReasoningEffort(' high ')).toBe('high');
    expect(normalizeReasoningEffort('minimal')).toBe('minimal');
  });
});

describe('isSdkEffortLevel', () => {
  it('accepts exactly the SDK EffortLevel union', () => {
    for (const level of SDK_EFFORT_LEVELS) expect(isSdkEffortLevel(level)).toBe(true);
  });
  it("rejects OpenAI-side values and 'default'/undefined — these must never reach query({ effort })", () => {
    expect(isSdkEffortLevel('minimal')).toBe(false);
    expect(isSdkEffortLevel('none')).toBe(false);
    expect(isSdkEffortLevel(REASONING_EFFORT_DEFAULT)).toBe(false);
    expect(isSdkEffortLevel(undefined)).toBe(false);
  });
});

describe('reasoningEffortChoices — per-surface vocabularies', () => {
  it('builtin + Anthropic protocol → SDK levels (no minimal)', () => {
    expect(reasoningEffortChoices('builtin')).toEqual(SDK_EFFORT_LEVELS);
    expect(reasoningEffortChoices('builtin', 'anthropic')).toEqual(SDK_EFFORT_LEVELS);
  });
  it('builtin + OpenAI protocol → cross-provider union incl. minimal/max', () => {
    expect(reasoningEffortChoices('builtin', 'openai')).toEqual(OPENAI_EFFORT_LEVELS);
  });
  it('uses model-specific Grok vocabularies and hides unverified model knobs', () => {
    expect(reasoningEffortChoices('builtin', 'openai', 'xai-sub', 'grok-4.6'))
      .toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(reasoningEffortChoices('builtin', 'openai', 'xai-sub', 'grok-4.5'))
      .toEqual(['low', 'medium', 'high']);
    expect(reasoningEffortChoices('builtin', 'openai', 'xai-sub', 'grok-4.3'))
      .toEqual(['none', 'low', 'medium', 'high']);
    expect(reasoningEffortChoices('builtin', 'openai', 'xai-sub', 'grok-build-0.1'))
      .toBeNull();
  });
  it('claude-code → SDK levels (matches `claude --effort` vocabulary)', () => {
    expect(reasoningEffortChoices('claude-code')).toEqual(SDK_EFFORT_LEVELS);
  });
  it('codex → minimal..xhigh (no max tier)', () => {
    expect(reasoningEffortChoices('codex')).toEqual(CODEX_EFFORT_LEVELS);
    expect(CODEX_EFFORT_LEVELS).not.toContain('max');
  });
  it('gemini / unknown → null (UI hides the row entirely)', () => {
    expect(reasoningEffortChoices('gemini')).toBeNull();
    expect(reasoningEffortChoices('some-future-runtime')).toBeNull();
  });
});

describe('reasoning effort coercion', () => {
  it('wire coercion collapses default so runtimes receive no effort override', () => {
    expect(coerceReasoningEffortForRuntime(REASONING_EFFORT_DEFAULT, 'codex')).toBeUndefined();
  });

  it('setting coercion preserves default so snapshots can override inherited values', () => {
    expect(coerceReasoningEffortSettingForRuntime(REASONING_EFFORT_DEFAULT, 'codex')).toBe(REASONING_EFFORT_DEFAULT);
    expect(coerceReasoningEffortSettingForRuntime('xhigh', 'codex')).toBe('xhigh');
    expect(coerceReasoningEffortSettingForRuntime('max', 'codex')).toBe('max');
  });
});


describe('model-advertised reasoning choices', () => {
  const model = { defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'future-tier' }] };
  it('preserves future values through birth and restore before discovery exists', () => {
    for (const value of ['ultra', 'future-tier']) {
      expect(coerceReasoningEffortSettingForRuntime(value, 'codex')).toBe(value);
      expect(coerceReasoningEffortForRuntime(value, 'codex')).toBe(value);
      expect(reasoningEffortAfterModelChange(value, undefined)).toBe(value);
      expect(reasoningEffortAfterModelChange(value, {})).toBe(value);
    }
  });
  it('resets only a known unsupported choice on explicit model selection', () => {
    expect(reasoningEffortAfterModelChange('future-tier', model)).toBe('future-tier');
    expect(reasoningEffortAfterModelChange('ultra', model)).toBe('default');
    expect(reasoningEffortAfterModelChange('default', model)).toBe('default');
    expect(reasoningEffortAfterModelChange('high', { supportedReasoningEfforts: [] })).toBe('default');
  });
});
