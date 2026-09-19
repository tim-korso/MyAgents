import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
    closeSessionSearch, searchSessionPage, searchSessions,
    type SessionSearchHit, type SessionSearchResult,
} from '@/api/searchClient';
import { normalizeWorkspacePathIdentity } from '../../shared/workspacePath';
import type { SessionMetadata } from '@/api/sessionClient';

type SearchStatus = 'idle' | 'searching' | 'indexing' | 'ready' | 'error';
interface SearchState {
    status: SearchStatus;
    hits: SessionSearchHit[];
    total: number;
    hasMore: boolean;
    loadingMore: boolean;
    pageError: 'expired' | 'failed' | null;
    queryId: string;
}
interface CurrentSearch {
    generation: number;
    closed: boolean;
    pagePending: boolean;
    result: SessionSearchResult | null;
}
const EMPTY: SearchState = {
    status: 'idle', hits: [], total: 0, hasMore: false,
    loadingMore: false, pageError: null, queryId: '',
};

/** One overlay owns one query intent and its pages; Rust owns the snapshot.
 * New input cancels computation, not just the eventual React state update.
 */
export function useHistorySearch({ query, tag, workspaces, enabled, composing }: {
    query: string;
    tag: string | null;
    workspaces: string[];
    enabled: boolean;
    composing: boolean;
}) {
    const [consumerId] = useState(() => crypto.randomUUID());
    const generation = useRef(0);
    const current = useRef<CurrentSearch | null>(null);
    const [state, setState] = useState<SearchState>(EMPTY);
    const [submission, setSubmission] = useState(0);
    const consumedSubmission = useRef(0);
    const workspaceKey = useMemo(() => JSON.stringify(
        [...new Set(workspaces.map(normalizeWorkspacePathIdentity))].sort(),
    ), [workspaces]);

    useEffect(() => {
        let disposed = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const close = (active: CurrentSearch | null) => {
            if (!active) return;
            active.closed = true;
            void closeSessionSearch(consumerId, active.generation).catch((error: unknown) => {
                console.error('[HistorySearch] Failed to release search', error);
            });
        };
        const run = async () => {
            if (disposed) return;
            close(current.current);
            const active: CurrentSearch = {
                generation: ++generation.current, closed: false, pagePending: false, result: null,
            };
            current.current = active;
            setState(previous => ({ ...previous, status: 'searching', hasMore: false,
                loadingMore: false, pageError: null }));
            try {
                const result = await searchSessions({
                    consumerId, generation: active.generation, query: query.trim(), tag,
                    workspaces: JSON.parse(workspaceKey) as string[],
                });
                if (disposed || active.closed || current.current !== active) {
                    close(active);
                    return;
                }
                active.result = result;
                setState({ status: 'ready', hits: result.hits, total: result.totalCount,
                    hasMore: result.nextCursor !== null, loadingMore: false, pageError: null,
                    queryId: result.queryId });
            } catch (error) {
                if (disposed || active.closed || current.current !== active) return;
                const preparing = String(error).includes('[search-indexing]');
                setState(previous => ({ ...previous, status: preparing ? 'indexing' : 'error',
                    hasMore: false, loadingMore: false }));
                // The first indexing pass has no query snapshot yet. This retry
                // belongs to this effect and cannot outlive its input or overlay.
                if (preparing) timer = setTimeout(() => { void run(); }, 500);
            }
        };

        const immediate = submission !== consumedSubmission.current;
        consumedSubmission.current = submission;
        if (!enabled || !query.trim()) {
            setState(EMPTY);
        } else {
            setState(previous => ({ ...previous, status: 'searching', hasMore: false,
                loadingMore: false, pageError: null }));
            if (!composing) {
                if (immediate) void run();
                else timer = setTimeout(() => { void run(); }, 200);
            }
        }
        return () => {
            disposed = true;
            clearTimeout(timer);
            close(current.current);
        };
    }, [consumerId, query, tag, workspaceKey, enabled, composing, submission]);

    const loadMore = useCallback(async () => {
        const active = current.current;
        const previous = active?.result;
        if (!active || active.closed || active.pagePending || !previous || previous.nextCursor === null) return;
        active.pagePending = true;
        setState(old => ({ ...old, loadingMore: true, pageError: null }));
        try {
            const page = await searchSessionPage({ consumerId, generation: active.generation,
                queryId: previous.queryId, cursor: previous.nextCursor });
            if (active.closed || current.current !== active) return;
            const removed = new Set(page.removedSessionIds);
            const localRemovals = (active.result?.removedSessionIds ?? []).filter(id => !removed.has(id));
            localRemovals.forEach(id => removed.add(id));
            const retained = (active.result?.hits ?? previous.hits).filter(hit => !removed.has(hit.sessionId));
            const known = new Set(retained.map(hit => hit.sessionId));
            const hits = [...retained, ...page.hits.filter(hit => !known.has(hit.sessionId) && !removed.has(hit.sessionId))];
            const total = page.totalCount - localRemovals.length;
            active.result = { ...page, hits, totalCount: total, removedSessionIds: [...removed] };
            setState({ status: 'ready', hits, total, hasMore: page.nextCursor !== null,
                loadingMore: false, pageError: null, queryId: page.queryId });
        } catch (error) {
            if (active.closed || current.current !== active) return;
            setState(old => ({ ...old, loadingMore: false,
                pageError: String(error).includes('[search-expired]') ? 'expired' : 'failed' }));
        } finally {
            active.pagePending = false;
        }
    }, [consumerId]);

    const refresh = useCallback(() => setSubmission(value => value + 1), []);
    const removeSessions = useCallback((ids: string[]) => {
        const active = current.current;
        if (!active || active.closed || !ids.length) return;
        if (!active.result) {
            // Old rows remain actionable while a new query is pending. Its
            // candidate set is unknown, so do not guess how deletion changes
            // its total: discard that generation and query the fresh authority.
            active.closed = true;
            const removed = new Set(ids);
            setState(old => ({ ...old, hits: old.hits.filter(hit => !removed.has(hit.sessionId)) }));
            setSubmission(value => value + 1);
            return;
        }
        const removed = new Set(active.result.removedSessionIds);
        const loaded = new Set(active.result.hits.map(hit => hit.sessionId));
        const added = [...new Set(ids)].filter(id => loaded.has(id) && !removed.has(id));
        if (!added.length) return;
        added.forEach(id => removed.add(id));
        const hits = active.result.hits.filter(hit => !removed.has(hit.sessionId));
        const total = active.result.totalCount - added.length;
        active.result = { ...active.result, hits, totalCount: total, removedSessionIds: [...removed] };
        setState(old => ({ ...old, hits, total }));
    }, []);
    const updateSession = useCallback((session: SessionMetadata) => {
        const active = current.current;
        if (!active?.result || active.closed) return;
        const hits = active.result.hits.map(hit => hit.sessionId === session.id ? { ...hit, session } : hit);
        active.result = { ...active.result, hits };
        // An acknowledged user mutation updates presentation, preserving the
        // query's immutable hit.lastActiveAt and continuation position.
        setState(old => ({ ...old, hits }));
    }, []);
    return { ...state, loadMore, refresh, updateSession, removeSessions };
}
