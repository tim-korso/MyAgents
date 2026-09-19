import { describe, expect, it } from 'vitest';

import type { SessionMetadata } from '../types/session';
import { normalizeSessionRuntimeIdentity } from './session-runtime-identity';

function session(overrides: Partial<SessionMetadata>): SessionMetadata {
  return {
    id: 'session-1',
    agentDir: '/tmp/workspace',
    title: 'Session',
    createdAt: '2026-07-12T00:00:00.000Z',
    lastActiveAt: '2026-07-12T00:00:00.000Z',
    ...overrides,
  };
}

describe('normalizeSessionRuntimeIdentity', () => {
  it('repairs historical builtin/managed-provider metadata as managed Codex', () => {
    const normalized = normalizeSessionRuntimeIdentity(session({
      runtime: 'builtin',
      runtimeSource: 'managed-provider',
      model: 'claude-fable-4-6',
      providerId: 'anthropic-sub',
      providerRoute: {
        kind: 'subscription',
        providerId: 'anthropic-sub',
        model: 'claude-fable-4-6',
      },
      providerEnvJson: '{"providerId":"anthropic-sub"}',
    }));

    expect(normalized.runtime).toBe('codex');
    expect(normalized.runtimeSource).toBe('managed-provider');
    expect(normalized.providerId).toBe('codex-sub');
    expect(normalized.providerRoute).toBeUndefined();
    expect(normalized.providerEnvJson).toBeUndefined();
  });

  it('leaves valid builtin and managed Codex identities unchanged', () => {
    const builtin = session({ runtime: 'builtin', providerId: 'anthropic-sub' });
    const managed = session({ runtime: 'codex', runtimeSource: 'managed-provider' });

    expect(normalizeSessionRuntimeIdentity(builtin)).toBe(builtin);
    expect(normalizeSessionRuntimeIdentity(managed)).toBe(managed);
  });
});
