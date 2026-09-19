import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ searchSessions: vi.fn(), searchSessionPage: vi.fn(), closeSessionSearch: vi.fn() }));
vi.mock('@/api/searchClient', () => api);

import type { SessionSearchResult } from '@/api/searchClient';
import { useHistorySearch } from './useHistorySearch';

function page(queryId: string, start = 0, nextCursor: number | null = 20): SessionSearchResult {
    return { queryId, nextCursor, removedSessionIds: [], totalCount: 40, queryTimeMs: 1,
        hits: Array.from({ length: 20 }, (_, n) => {
            const id = `${queryId}-${start + n}`;
            const session = { id, title: id, agentDir: '/workspace', createdAt: '2026-01-01T00:00:00Z', lastActiveAt: '2026-09-01T00:00:00Z' };
            return { session, sessionId: id, title: id, agentDir: '/workspace', score: 1, matchType: 'content',
                snippet: 'matched text', snippetHighlights: [], titleHighlights: [], matchedRole: 'user',
                lastActiveAt: session.lastActiveAt, source: 'desktop', turnCount: 1 };
        }) };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}
const options = { query: 'needle', tag: null, workspaces: ['/workspace'], enabled: true, composing: false };
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe('useHistorySearch', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetAllMocks();
        api.closeSessionSearch.mockResolvedValue(undefined);
        api.searchSessions.mockResolvedValue(page('query'));
    });
    afterEach(() => vi.useRealTimers());

    it('debounces input and sends the complete normalized scope', async () => {
        const { result, rerender } = renderHook(props => useHistorySearch(props), { initialProps: options });
        await advance(150);
        rerender({ ...options, query: 'needle refined' });
        await advance(199);
        expect(api.searchSessions).not.toHaveBeenCalled();
        await advance(1);
        expect(api.searchSessions).toHaveBeenCalledOnce();
        expect(api.searchSessions).toHaveBeenCalledWith(expect.objectContaining({ query: 'needle refined', workspaces: ['/workspace'], tag: null }));
        expect(result.current.hits).toHaveLength(20);
    });

    it('waits for IME composition and Enter consumes the pending debounce', async () => {
        const { result, rerender } = renderHook(props => useHistorySearch(props), { initialProps: { ...options, composing: true } });
        await advance(1000);
        expect(api.searchSessions).not.toHaveBeenCalled();
        rerender({ ...options, query: '微信 连接失败', composing: false });
        act(() => result.current.refresh());
        await advance(0);
        expect(api.searchSessions).toHaveBeenCalledOnce();
        expect(api.searchSessions).toHaveBeenCalledWith(expect.objectContaining({ query: '微信 连接失败' }));
        await advance(500);
        expect(api.searchSessions).toHaveBeenCalledOnce();
    });

    it('closes the superseded generation and ignores its late response', async () => {
        const old = deferred<SessionSearchResult>();
        api.searchSessions.mockReturnValueOnce(old.promise).mockResolvedValueOnce(page('new'));
        const { result, rerender } = renderHook(props => useHistorySearch(props), { initialProps: options });
        await advance(200);
        const firstRequest = api.searchSessions.mock.calls[0][0];
        rerender({ ...options, query: 'new' });
        expect(api.closeSessionSearch).toHaveBeenCalledWith(firstRequest.consumerId, firstRequest.generation);
        await advance(200);
        await act(async () => old.resolve(page('old')));
        expect(result.current.queryId).toBe('new');
        expect(result.current.hits[0].sessionId).toBe('new-0');
    });

    it('requests a cursor only once while a page is pending and preserves old row identities', async () => {
        const next = deferred<SessionSearchResult>();
        api.searchSessionPage.mockReturnValue(next.promise);
        const { result } = renderHook(() => useHistorySearch(options));
        await advance(200);
        const first = result.current.hits[0];
        act(() => { void result.current.loadMore(); void result.current.loadMore(); });
        expect(api.searchSessionPage).toHaveBeenCalledOnce();
        expect(api.searchSessionPage).toHaveBeenCalledWith(expect.objectContaining({ queryId: 'query', cursor: 20 }));
        await act(async () => next.resolve(page('query', 20, null)));
        expect(result.current.hits).toHaveLength(40);
        expect(result.current.hits[0]).toBe(first);
        expect(result.current.hasMore).toBe(false);
        await act(async () => { await result.current.loadMore(); });
        expect(api.searchSessionPage).toHaveBeenCalledOnce();
    });

    it('retains acknowledged deletion across a stale in-flight page and later server confirmation', async () => {
        const next = deferred<SessionSearchResult>();
        api.searchSessionPage.mockReturnValueOnce(next.promise);
        const { result } = renderHook(() => useHistorySearch(options));
        await advance(200);
        act(() => { void result.current.loadMore(); });
        act(() => result.current.removeSessions(['query-0', 'query-0']));
        expect(result.current.total).toBe(39);
        await act(async () => next.resolve(page('query', 20, 40)));
        expect(result.current.total).toBe(39);
        expect(result.current.hits).toHaveLength(39);
        api.searchSessionPage.mockResolvedValueOnce({ ...page('query', 40, null), hits: [], totalCount: 39, removedSessionIds: ['query-0'] });
        await act(async () => { await result.current.loadMore(); });
        expect(result.current.total).toBe(39);
        expect(result.current.hits).toHaveLength(39);
    });

    it('keeps loaded rows and retries the same cursor after a page error', async () => {
        api.searchSessionPage.mockRejectedValueOnce(new Error('disk error')).mockResolvedValueOnce(page('query', 20, null));
        const { result } = renderHook(() => useHistorySearch(options));
        await advance(200);
        await act(async () => { await result.current.loadMore(); });
        expect(result.current.pageError).toBe('failed');
        expect(result.current.hits).toHaveLength(20);
        await act(async () => { await result.current.loadMore(); });
        expect(result.current.hits).toHaveLength(40);
        expect(api.searchSessionPage.mock.calls.map(call => call[0].cursor)).toEqual([20, 20]);
    });

    it('restarts a pending first query when an old visible row is deleted', async () => {
        const pending = deferred<SessionSearchResult>();
        const { result, rerender } = renderHook(props => useHistorySearch(props), { initialProps: options });
        await advance(200);
        api.searchSessions.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(page('fresh'));
        rerender({ ...options, query: 'refined' });
        await advance(200);
        act(() => result.current.removeSessions(['query-0']));
        await advance(0);
        expect(api.searchSessions).toHaveBeenCalledTimes(3);
        expect(result.current.queryId).toBe('fresh');
        // A metadata refresh may already have cleared its deletion tombstone.
        await act(async () => pending.resolve(page('query')));
        expect(result.current.queryId).toBe('fresh');
        expect(result.current.hits.some(hit => hit.sessionId === 'query-0')).toBe(false);
    });

    it('reconciles removed rows without losing acknowledged edits while a page is pending', async () => {
        const next = deferred<SessionSearchResult>();
        api.searchSessionPage.mockReturnValue(next.promise);
        const { result } = renderHook(() => useHistorySearch(options));
        await advance(200);
        act(() => { void result.current.loadMore(); });
        act(() => result.current.updateSession({ ...result.current.hits[1].session, title: 'Renamed' }));
        await act(async () => next.resolve({ ...page('query', 20, null), removedSessionIds: ['query-0'], totalCount: 39 }));
        expect(result.current.hits).toHaveLength(39);
        expect(result.current.hits[0].sessionId).toBe('query-1');
        expect(result.current.hits[0].session.title).toBe('Renamed');
        expect(result.current.total).toBe(39);
    });

    it('keeps expired results visible until the user explicitly starts a fresh query', async () => {
        api.searchSessionPage.mockRejectedValue('[search-expired]');
        const { result } = renderHook(() => useHistorySearch(options));
        await advance(200);
        await act(async () => { await result.current.loadMore(); });
        expect(result.current.pageError).toBe('expired');
        expect(result.current.hits).toHaveLength(20);
        api.searchSessions.mockResolvedValue(page('refreshed'));
        act(() => result.current.refresh());
        await advance(0);
        expect(result.current.queryId).toBe('refreshed');
        expect(result.current.pageError).toBeNull();
    });

    it('does not let a late page append into a new keyword search', async () => {
        const next = deferred<SessionSearchResult>();
        api.searchSessionPage.mockReturnValue(next.promise);
        const { result, rerender } = renderHook(props => useHistorySearch(props), { initialProps: options });
        await advance(200);
        act(() => { void result.current.loadMore(); });
        api.searchSessions.mockResolvedValue(page('new'));
        rerender({ ...options, query: 'new' });
        await advance(200);
        await act(async () => next.resolve(page('query', 20, null)));
        expect(result.current.queryId).toBe('new');
        expect(result.current.hits).toHaveLength(20);
    });

    it('releases a completed snapshot on unmount and handles StrictMode setup-cleanup', async () => {
        const { unmount } = renderHook(() => useHistorySearch(options), { wrapper: StrictMode });
        await advance(200);
        expect(api.searchSessions).toHaveBeenCalledOnce();
        const input = api.searchSessions.mock.calls[0][0];
        unmount();
        expect(api.closeSessionSearch).toHaveBeenCalledWith(input.consumerId, input.generation);
        await advance(1000);
        expect(api.searchSessions).toHaveBeenCalledOnce();
    });

    it('retries index preparation within this query and stops retrying on close', async () => {
        api.searchSessions.mockRejectedValue('[search-indexing]');
        const { result, unmount } = renderHook(() => useHistorySearch(options));
        await advance(200);
        expect(result.current.status).toBe('indexing');
        await advance(500);
        expect(api.searchSessions).toHaveBeenCalledTimes(2);
        unmount();
        await advance(1500);
        expect(api.searchSessions).toHaveBeenCalledTimes(2);
    });
});
