import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ home: '' }));
vi.mock('os', async original => ({ ...await original<typeof import('os')>(), homedir: () => state.home }));
let store: typeof import('../SessionStore');
let sessionId: string;
beforeEach(async () => {
  state.home = await mkdtemp(join(tmpdir(), 'myagents-snapshot-owner-'));
  vi.resetModules();
  store = await import('../SessionStore');
});
afterEach(async () => {
  await store.getActiveSessionTranscript(sessionId)?.revoke();
  await rm(state.home, { recursive: true, force: true });
});

it.each(['managed-provider', 'system-cli'] as const)('publishes every %s permission switch to the next-turn active snapshot', async runtimeSource => {
  const metadata = await store.createSession('/workspace', {
    runtime: 'codex', runtimeSource,
    permissionMode: 'auto-edit', configSnapshotAt: '2026-09-13T00:00:00.000Z',
  });
  sessionId = metadata.id;
  const { buildSessionSnapshotPatchUpdates } = await import('../utils/session-snapshot-patch');
  const modes = runtimeSource === 'managed-provider'
    ? ['suggest', 'no-restrictions', 'auto-edit']
    : ['full-auto', 'no-restrictions', 'auto-edit'];
  for (const [index, permissionMode] of modes.entries()) {
    const existing = store.getSessionMetadata(sessionId)!;
    const updates = buildSessionSnapshotPatchUpdates({ existing, payload: { permissionMode }, nowIso: `2026-09-13T00:00:0${index + 1}.000Z` });
    await store.updateSessionMetadata(sessionId, updates, current => current.configSnapshotAt === existing.configSnapshotAt);
    // The send route reads this active binding immediately, without a later
    // native event/flush refreshing it from Global's on-disk metadata.
    expect(store.getSessionMetadata(sessionId)?.permissionMode).toBe(permissionMode);
    expect(store.getActiveSessionTranscript(sessionId)?.metadata.permissionMode).toBe(permissionMode);
    const disk = JSON.parse(await readFile(join(state.home, '.myagents', 'sessions.json'), 'utf8'));
    expect(disk.find((row: { id: string }) => row.id === sessionId).permissionMode).toBe(permissionMode);
  }
});
