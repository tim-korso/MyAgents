import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { closeSessionSearch, searchSessionPage, searchSessions, searchWorkspaceFiles } from './searchClient';

describe('session search IPC', () => {
  beforeEach(() => invokeMock.mockReset());

  it('passes the query scope and generation as one typed command request', async () => {
    const request = { consumerId: 'overlay', generation: 2, query: '微信 连接失败', tag: 'Alpha', workspaces: ['/workspace'] };
    invokeMock.mockResolvedValue({ queryId: 'q', hits: [], nextCursor: null, removedSessionIds: [], totalCount: 0, queryTimeMs: 1 });
    await searchSessions(request);
    expect(invokeMock).toHaveBeenCalledWith('cmd_search_sessions', { request });
  });

  it('pages and closes the exact query generation through Rust', async () => {
    const request = { consumerId: 'overlay', generation: 2, queryId: 'q', cursor: 20 };
    await searchSessionPage(request);
    expect(invokeMock).toHaveBeenCalledWith('cmd_search_session_page', { request });
    await closeSessionSearch('overlay', 2);
    expect(invokeMock).toHaveBeenLastCalledWith('cmd_close_session_search', { consumerId: 'overlay', generation: 2 });
  });
});

describe('searchWorkspaceFiles', () => {
  beforeEach(() => invokeMock.mockReset());

  it('returns the atomic empty folder/file response without IPC for blank queries', async () => {
    await expect(searchWorkspaceFiles('   ', '/workspace')).resolves.toEqual({
      folderHits: [],
      hits: [],
      totalFolders: 0,
      totalFiles: 0,
      queryTimeMs: 0,
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('requests folder and file hits through the existing single Tauri command', async () => {
    const response = {
      folderHits: [{ path: 'docs', name: 'docs' }],
      hits: [],
      totalFolders: 1,
      totalFiles: 0,
      queryTimeMs: 2,
    };
    invokeMock.mockResolvedValue(response);

    await expect(searchWorkspaceFiles('docs', '/workspace')).resolves.toBe(response);
    expect(invokeMock).toHaveBeenCalledWith('cmd_search_workspace_files', {
      query: 'docs',
      workspace: '/workspace',
      limit: 50,
      maxMatchesPerFile: 10,
    });
  });
});
