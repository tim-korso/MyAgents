import { describe, expect, it } from 'vitest';

import {
  coerceRuntimeBirthPermissionMode,
  coerceRuntimeBirthReasoningEffort,
} from './runtimeBirthFields';

describe('runtime birth field coercion', () => {
  it('normalizes foreign permission and reasoning values to target runtime defaults', () => {
    expect(coerceRuntimeBirthPermissionMode('auto', 'codex')).toBe('full-auto');
    expect(coerceRuntimeBirthPermissionMode('fullAgency', 'codex')).toBe('full-auto');
    expect(coerceRuntimeBirthReasoningEffort('max', 'codex')).toBe('max');
  });

  it('preserves target-runtime permission and reasoning values', () => {
    expect(coerceRuntimeBirthPermissionMode('no-restrictions', 'codex')).toBe('no-restrictions');
    expect(coerceRuntimeBirthReasoningEffort('xhigh', 'codex')).toBe('xhigh');
  });

  it('does not invent snapshot fields when the birth payload omits them', () => {
    expect(coerceRuntimeBirthPermissionMode(undefined, 'codex')).toBeUndefined();
    expect(coerceRuntimeBirthReasoningEffort(undefined, 'codex')).toBeUndefined();
  });
});
