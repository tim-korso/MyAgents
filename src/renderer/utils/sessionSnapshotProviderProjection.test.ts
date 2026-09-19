import { describe, expect, it } from 'vitest';

import {
  isManagedProviderSessionSnapshot,
  managedProviderSnapshotModel,
  managedProviderSnapshotProviderId,
  shouldSessionSnapshotUseProviderPicker,
} from './sessionSnapshotProviderProjection';

describe('sessionSnapshotProviderProjection', () => {
  it('projects Managed Codex runtime snapshots back into the Provider picker surface', () => {
    const session = {
      runtimeSource: 'managed-provider' as const,
      providerExecutionIdentity: {
        kind: 'runtime-backed-provider' as const,
        providerId: 'codex-sub' as const,
        runtime: 'codex' as const,
        runtimeSource: 'managed-provider' as const,
        model: 'gpt-5.5',
      },
    };

    expect(isManagedProviderSessionSnapshot(session)).toBe(true);
    expect(shouldSessionSnapshotUseProviderPicker({
      session,
      runtime: 'codex',
    })).toBe(true);
    expect(managedProviderSnapshotProviderId(session)).toBe('codex-sub');
    expect(managedProviderSnapshotModel(session, 'stale-agent-model')).toBe('gpt-5.5');
  });

  it('keeps user-managed Codex CLI snapshots on the external runtime surface', () => {
    const session = {
      runtimeSource: 'system-cli' as const,
      providerId: 'codex-sub',
    };

    expect(isManagedProviderSessionSnapshot(session)).toBe(false);
    expect(shouldSessionSnapshotUseProviderPicker({
      session,
      runtime: 'codex',
    })).toBe(false);
    expect(managedProviderSnapshotProviderId(session)).toBeUndefined();
    expect(managedProviderSnapshotModel(session, 'runtime-model')).toBe('runtime-model');
  });

  it('repairs older Managed Codex snapshots without providerExecutionIdentity', () => {
    const session = {
      runtimeSource: 'managed-provider' as const,
      providerId: 'codex-sub',
    };

    expect(shouldSessionSnapshotUseProviderPicker({
      session,
      runtime: 'codex',
    })).toBe(true);
    expect(managedProviderSnapshotProviderId(session)).toBe('codex-sub');
    expect(managedProviderSnapshotModel(session, 'gpt-5.4')).toBe('gpt-5.4');
  });
});
