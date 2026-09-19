import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ListItem, ListRange } from 'react-virtuoso';

import type { Message as MessageType } from '@/types/chat';

const DEBUG_STORAGE_KEY = 'myagents:chat-scroll-debug';
const MESSAGE_SCOPE_SELECTOR = '[data-chat-search-scope][data-message-id]';

function isProbeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(DEBUG_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function topAnchor(scroller: HTMLElement): { messageId: string; offset: number } | null {
  const scrollerRect = scroller.getBoundingClientRect();
  const scopes = Array.from(scroller.querySelectorAll<HTMLElement>(MESSAGE_SCOPE_SELECTOR));
  for (const scope of scopes) {
    const rect = scope.getBoundingClientRect();
    if (rect.bottom <= scrollerRect.top || rect.top >= scrollerRect.bottom) continue;
    const messageId = scope.getAttribute('data-message-id');
    if (!messageId) continue;
    return { messageId, offset: Math.round(rect.top - scrollerRect.top) };
  }
  return null;
}

function visibleRowHeights(scroller: HTMLElement): Array<{ messageId: string; height: number }> {
  const scrollerRect = scroller.getBoundingClientRect();
  return Array.from(scroller.querySelectorAll<HTMLElement>(MESSAGE_SCOPE_SELECTOR))
    .flatMap((scope) => {
      const rect = scope.getBoundingClientRect();
      if (rect.bottom <= scrollerRect.top || rect.top >= scrollerRect.bottom) return [];
      const messageId = scope.getAttribute('data-message-id');
      if (!messageId) return [];
      return [{ messageId, height: Math.round(rect.height) }];
    });
}

export function useChatScrollDebugProbe({
  sessionId,
  scroller,
  data,
  heightEstimateSeed,
}: {
  sessionId?: string | null;
  scroller: HTMLElement | null;
  data: readonly MessageType[];
  heightEstimateSeed?: readonly number[];
}) {
  const enabled = useMemo(() => isProbeEnabled(), []);
  const lastWheelRef = useRef<{ deltaY: number; at: number } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (!scroller) return;
    const onWheel = (event: WheelEvent) => {
      lastWheelRef.current = { deltaY: event.deltaY, at: Date.now() };
    };
    scroller.addEventListener('wheel', onWheel, { passive: true });
    return () => scroller.removeEventListener('wheel', onWheel);
  }, [enabled, scroller]);

  const snapshot = useCallback((kind: string, payload: Record<string, unknown>) => {
    if (!enabled) return;
    if (!scroller) return;
    const anchor = topAnchor(scroller);
    console.debug('[chat-scroll]', kind, {
      sessionId,
      scrollTop: Math.round(scroller.scrollTop),
      scrollHeight: Math.round(scroller.scrollHeight),
      viewportHeight: Math.round(scroller.clientHeight),
      lastWheel: lastWheelRef.current,
      anchor,
      rowHeights: visibleRowHeights(scroller),
      dataLength: data.length,
      estimateLength: heightEstimateSeed?.length ?? 0,
      ...payload,
    });
  }, [data.length, enabled, heightEstimateSeed?.length, scroller, sessionId]);

  const handleRangeChanged = useCallback((range: ListRange) => {
    snapshot('rangeChanged', { range });
  }, [snapshot]);

  const handleItemsRendered = useCallback((items: ListItem<MessageType>[]) => {
    snapshot('itemsRendered', {
      items: items.map((item) => ({
        index: item.index,
        originalIndex: 'originalIndex' in item ? item.originalIndex : undefined,
        size: item.size,
        offset: item.offset,
      })),
    });
  }, [snapshot]);

  return enabled ? { handleRangeChanged, handleItemsRendered } : null;
}
