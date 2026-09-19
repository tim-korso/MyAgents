import { describe, expect, it } from 'vitest';

import {
  filterRuntimeConfigPatchForSnapshot,
  getDefaultExternalConfigCapabilities,
  isExternalModelConfigNoop,
  isRuntimeConfigPatchNoopAgainstDesired,
  mergeRuntimeConfigPatches,
  runtimeConfigPatchKeys,
  shouldApplySnapshotConfigUpdate,
  shouldDeferExternalConfigOperation,
} from './runtime-config-policy';

describe('runtime-config-policy snapshot guard', () => {
  it('keeps snapshotted desktop-owned sessions authoritative over IM sync', () => {
    expect(shouldApplySnapshotConfigUpdate({
      field: 'model',
      source: 'im-sync',
      isSnapshotted: true,
    })).toBe(false);
    expect(shouldApplySnapshotConfigUpdate({
      field: 'permissionMode',
      source: 'legacy-permission-mode-set',
      isSnapshotted: true,
    })).toBe(false);
    expect(shouldApplySnapshotConfigUpdate({
      field: 'reasoningEffort',
      source: 'im-sync',
      isSnapshotted: true,
    })).toBe(false);
  });

  it('allows desktop pushes and pure IM live-follow updates', () => {
    expect(shouldApplySnapshotConfigUpdate({
      field: 'model',
      source: 'desktop',
      isSnapshotted: true,
    })).toBe(true);
    expect(shouldApplySnapshotConfigUpdate({
      field: 'provider',
      source: 'im-sync',
      isSnapshotted: false,
    })).toBe(true);
  });

  it('filters IM runtime config fields before they mutate snapshotted desired state', () => {
    const filtered = filterRuntimeConfigPatchForSnapshot({
      patch: {
        model: 'channel-model',
        permissionMode: 'full-auto',
        reasoningEffort: 'high',
      },
      source: 'im-sync',
      isSnapshotted: true,
    });

    expect(filtered).toEqual({
      patch: {},
      skippedKeys: ['model', 'permissionMode', 'reasoningEffort'],
    });
  });

  it('keeps runtime-config patches authoritative for desktop-owned runtime updates', () => {
    const filtered = filterRuntimeConfigPatchForSnapshot({
      patch: { model: 'desktop-model', reasoningEffort: 'xhigh' },
      source: 'runtime-config',
      isSnapshotted: true,
    });

    expect(filtered).toEqual({
      patch: { model: 'desktop-model', reasoningEffort: 'xhigh' },
      skippedKeys: [],
    });
  });
});

describe('runtime-config-policy external config', () => {
  it('classifies runtime config apply capabilities', () => {
    expect(getDefaultExternalConfigCapabilities('codex')).toEqual({
      model: 'next_turn_state',
      permissionMode: 'next_turn_state',
      reasoningEffort: 'next_turn_state',
    });
    expect(getDefaultExternalConfigCapabilities('gemini')).toEqual({
      model: 'live_session_rpc',
      permissionMode: 'live_session_rpc',
      reasoningEffort: 'unsupported',
    });
  });

  it('merges patches and exposes touched keys', () => {
    const merged = mergeRuntimeConfigPatches(
      { model: 'gpt-5.1', permissionMode: 'full-auto' },
      { model: 'gpt-5.2', reasoningEffort: 'xhigh' },
    );
    expect(merged).toEqual({
      model: 'gpt-5.2',
      permissionMode: 'full-auto',
      reasoningEffort: 'xhigh',
    });
    expect(runtimeConfigPatchKeys(merged)).toEqual(['model', 'permissionMode', 'reasoningEffort']);
  });

  it('detects no-op patches without triggering boundary work', () => {
    expect(isRuntimeConfigPatchNoopAgainstDesired(
      { model: 'runtime-model' },
      {
        desiredModel: 'desired-model',
        liveReportedModel: 'runtime-model',
        desiredPermissionMode: 'auto',
        desiredReasoningEffort: '',
      },
      { allowLiveReportedModel: true },
    )).toBe(true);
    expect(isExternalModelConfigNoop('runtime-model', 'desired-model', 'runtime-model', {
      allowLiveReportedModel: false,
    })).toBe(false);
  });

  it('defers config behind running turns, queued work, drains, or finalization', () => {
    expect(shouldDeferExternalConfigOperation('running', 0, false, false)).toBe(true);
    expect(shouldDeferExternalConfigOperation('idle', 1, false, false)).toBe(true);
    expect(shouldDeferExternalConfigOperation('idle', 0, true, false)).toBe(true);
    expect(shouldDeferExternalConfigOperation('idle', 0, false, true)).toBe(true);
    expect(shouldDeferExternalConfigOperation('idle', 0, false, false)).toBe(false);
  });
});
