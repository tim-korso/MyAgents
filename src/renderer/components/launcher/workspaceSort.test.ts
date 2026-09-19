import { describe, expect, it } from 'vitest';
import type { Project } from '@/config/types';
import { sortLauncherProjects } from './workspaceSort';

const project = (overrides: Partial<Project>): Project => ({
  id: overrides.id ?? 'project-id',
  name: overrides.name ?? 'Project',
  path: overrides.path ?? `/tmp/${overrides.id ?? 'project-id'}`,
  lastOpened: overrides.lastOpened ?? '2026-01-01T00:00:00.000Z',
  providerId: null,
  permissionMode: null,
  ...overrides,
});

describe('sortLauncherProjects', () => {
  it('orders pinned projects first by latest pin time', () => {
    const sorted = sortLauncherProjects([
      project({ id: 'unpinned-recent', name: 'Recent', lastOpened: '2026-06-01T00:00:00.000Z' }),
      project({ id: 'pinned-old', name: 'Pinned Old', pinnedAt: '2026-05-01T00:00:00.000Z' }),
      project({ id: 'pinned-new', name: 'Pinned New', pinnedAt: '2026-06-01T00:00:00.000Z' }),
    ]);

    expect(sorted.map((item) => item.id)).toEqual(['pinned-new', 'pinned-old', 'unpinned-recent']);
  });

  it('orders unpinned projects by last opened time', () => {
    const sorted = sortLauncherProjects([
      project({ id: 'older', name: 'Older', lastOpened: '2026-01-01T00:00:00.000Z' }),
      project({ id: 'newer', name: 'Newer', lastOpened: '2026-02-01T00:00:00.000Z' }),
    ]);

    expect(sorted.map((item) => item.id)).toEqual(['newer', 'older']);
  });

  it('treats a cleared pin as an ordinary last-opened workspace', () => {
    const sorted = sortLauncherProjects([
      project({ id: 'ordinary', name: 'Ordinary', lastOpened: '2026-02-01T00:00:00.000Z' }),
      project({ id: 'cleared', name: 'Cleared', pinnedAt: undefined, lastOpened: '2026-03-01T00:00:00.000Z' }),
      project({ id: 'pinned', name: 'Pinned', pinnedAt: '2026-01-01T00:00:00.000Z', lastOpened: '2026-01-01T00:00:00.000Z' }),
    ]);

    expect(sorted.map((item) => item.id)).toEqual(['pinned', 'cleared', 'ordinary']);
  });

  it('uses the display label as the stable tie breaker', () => {
    const sorted = sortLauncherProjects([
      project({ id: 'zulu', displayName: 'Zulu', lastOpened: '2026-01-01T00:00:00.000Z' }),
      project({ id: 'alpha', displayName: 'Alpha', lastOpened: '2026-01-01T00:00:00.000Z' }),
    ]);

    expect(sorted.map((item) => item.id)).toEqual(['alpha', 'zulu']);
  });
});
