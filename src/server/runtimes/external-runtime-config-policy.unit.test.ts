import { describe, expect, it } from 'vitest';

import {
  getDefaultExternalConfigCapabilities,
  isExternalModelConfigNoop,
  mergeExternalRuntimeConfigPatches,
  shouldDeferExternalConfigOperation,
} from './external-session';

describe('external runtime config capability policy', () => {
  it('classifies Codex and Claude Code config as next-turn state', () => {
    expect(getDefaultExternalConfigCapabilities('codex')).toEqual({
      model: 'next_turn_state',
      permissionMode: 'next_turn_state',
      reasoningEffort: 'next_turn_state',
    });
    expect(getDefaultExternalConfigCapabilities('claude-code')).toEqual({
      model: 'next_turn_state',
      permissionMode: 'next_turn_state',
      reasoningEffort: 'next_turn_state',
    });
  });

  it('keeps Gemini model and permission on boundary-delayed RPCs', () => {
    expect(getDefaultExternalConfigCapabilities('gemini')).toEqual({
      model: 'live_session_rpc',
      permissionMode: 'live_session_rpc',
      reasoningEffort: 'unsupported',
    });
  });

  it('merges only consecutive config patch fields and lets later values win', () => {
    expect(mergeExternalRuntimeConfigPatches(
      { model: 'gpt-5.1', permissionMode: 'full-auto' },
      { model: 'gpt-5.2', reasoningEffort: 'xhigh' },
    )).toEqual({
      model: 'gpt-5.2',
      permissionMode: 'full-auto',
      reasoningEffort: 'xhigh',
    });
  });

  it('uses live runtime model for noop only when no boundary work is pending', () => {
    expect(isExternalModelConfigNoop('model-a', 'model-b', 'model-a', {
      allowLiveReportedModel: true,
    })).toBe(true);

    expect(isExternalModelConfigNoop('model-a', 'model-b', 'model-a', {
      allowLiveReportedModel: false,
    })).toBe(false);
  });
});

describe('external runtime config defer policy', () => {
  it('defers config while a turn is running', () => {
    expect(shouldDeferExternalConfigOperation('running', 0, false, false)).toBe(true);
  });

  it('defers config behind queued operations to preserve FIFO', () => {
    expect(shouldDeferExternalConfigOperation('idle', 1, false, false)).toBe(true);
  });

  it('defers config while boundary drain or finalization is in flight', () => {
    expect(shouldDeferExternalConfigOperation('idle', 0, true, false)).toBe(true);
    expect(shouldDeferExternalConfigOperation('idle', 0, false, true)).toBe(true);
  });

  it('applies immediately only when idle with no queued boundary work', () => {
    expect(shouldDeferExternalConfigOperation('idle', 0, false, false)).toBe(false);
  });
});
