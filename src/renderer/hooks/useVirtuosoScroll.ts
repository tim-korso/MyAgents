/**
 * Owns chat follow intent. Geometry changes never turn following into reading.
 * Upward viewport input/navigation pauses; explicit bottom navigation or downward
 * input reaching the actual bottom resumes. `force` marks a requested bottom jump.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';

export interface VirtuosoScrollControls {
    virtuosoRef: React.RefObject<VirtuosoHandle | null>;
    scrollerRef: React.MutableRefObject<HTMLElement | null>;
    followEnabledRef: React.MutableRefObject<boolean | 'force'>;
    scrollToBottom: (behavior?: 'smooth' | 'auto') => void;
    /** Enters reading mode until the user returns to the bottom. */
    pauseAutoScroll: () => void;
    handleAtBottomChange: (atBottom: boolean) => void;
    /**
     * Callback-ref for Virtuoso's `scrollerRef` prop. Stores the element for external
     * consumers (chatSearch, etc.) AND manages the user-intent listener lifecycle.
     */
    attachScroller: (el: HTMLElement | Window | null) => void;
}

export interface UseVirtuosoScrollOptions {
    /** Fires only for direct viewport input, before follow-state policy is applied. */
    onUserScrollIntent?: () => void;
}

// Fallback: degrade 'force' → true after this long even if atBottom(true) never fires.
// Without this, a session where streaming content grows faster than the smooth scroll
// can reach bottom (and no wheel/key events arrive — e.g., trackpad-only / scrollbar
// drag / unusual inputs) leaks force indefinitely into future content changes.
const FORCE_AUTO_DEGRADE_MS = 1500;

export function useVirtuosoScroll({ onUserScrollIntent }: UseVirtuosoScrollOptions = {}): VirtuosoScrollControls {
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const scrollerRef = useRef<HTMLElement | null>(null);
    const followEnabledRef = useRef<boolean | 'force'>(true);
    const towardBottomRef = useRef(false);
    const scrollbarDragRef = useRef(false);
    const lastScrollTopRef = useRef(0);
    const forceDegradeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onUserScrollIntentRef = useRef(onUserScrollIntent);
    // Ref mirror keeps native input listeners stable while observing the latest owner callback.
    // eslint-disable-next-line react-hooks/refs
    onUserScrollIntentRef.current = onUserScrollIntent;
    const notifyUserScrollIntent = useCallback(() => {
        onUserScrollIntentRef.current?.();
    }, []);

    const clearForceDegradeTimer = useCallback(() => {
        if (forceDegradeTimerRef.current) {
            clearTimeout(forceDegradeTimerRef.current);
            forceDegradeTimerRef.current = null;
        }
    }, []);

    // Explicit navigation still uses the virtualizer's index model to mount the
    // last row. MessageList then aligns any measured growth through its scroll API.
    const scrollToBottom = useCallback((behavior: 'smooth' | 'auto' = 'smooth') => {
        towardBottomRef.current = false;
        followEnabledRef.current = 'force';
        virtuosoRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior });
        clearForceDegradeTimer();
        forceDegradeTimerRef.current = setTimeout(() => {
            forceDegradeTimerRef.current = null;
            if (followEnabledRef.current === 'force') {
                followEnabledRef.current = true;
            }
        }, FORCE_AUTO_DEGRADE_MS);
    }, [clearForceDegradeTimer]);

    const pauseAutoScroll = useCallback(() => {
        followEnabledRef.current = false;
        towardBottomRef.current = false;
        clearForceDegradeTimer();
        // Cancel an in-flight smooth jump, including search navigation. scrollBy
        // goes through Virtuoso but, unlike scrollTo(currentTop), isn't elided.
        virtuosoRef.current?.scrollBy({ top: 0, behavior: 'auto' });
    }, [clearForceDegradeTimer]);

    const handleAtBottomChange = useCallback((atBottom: boolean) => {
        if (atBottom && followEnabledRef.current === 'force') {
            followEnabledRef.current = true;
            clearForceDegradeTimer();
        }
        // This callback describes geometry (including footer/viewport resizing),
        // not user intent. In particular its 50px threshold cannot resume reading.
    }, [clearForceDegradeTimer]);

    const resumeAtBottom = useCallback(() => {
        const el = scrollerRef.current;
        if (followEnabledRef.current === false && towardBottomRef.current && el && el.scrollHeight - el.clientHeight - el.scrollTop <= 1) {
            followEnabledRef.current = true;
            towardBottomRef.current = false;
            clearForceDegradeTimer();
        }
    }, [clearForceDegradeTimer]);

    const moveTowardBottom = useCallback(() => {
        // Downward input also supersedes an outstanding search/index jump while
        // reading; it resumes following only once the user actually reaches bottom.
        // While smooth follow is catching up, downward input must also take
        // control. Resume immediately only when it reaches the actual bottom.
        pauseAutoScroll();
        towardBottomRef.current = true;
        resumeAtBottom();
    }, [pauseAutoScroll, resumeAtBottom]);

    const onScroll = useCallback(() => {
        const el = scrollerRef.current;
        if (!el) return;
        if (scrollbarDragRef.current) {
            if (el.scrollTop < lastScrollTopRef.current) pauseAutoScroll();
            else if (el.scrollTop > lastScrollTopRef.current) towardBottomRef.current = true;
        }
        lastScrollTopRef.current = el.scrollTop;
        resumeAtBottom();
    }, [pauseAutoScroll, resumeAtBottom]);

    const onWheel = useCallback((e: WheelEvent) => {
        if (e.deltaY === 0) return;
        notifyUserScrollIntent();
        if (e.deltaY < 0) pauseAutoScroll();
        else moveTowardBottom();
    }, [pauseAutoScroll, notifyUserScrollIntent, moveTowardBottom]);

    const touchStartYRef = useRef(0);
    const onTouchStart = useCallback((e: TouchEvent) => {
        touchStartYRef.current = e.touches[0]?.clientY ?? 0;
    }, []);
    const onTouchMove = useCallback((e: TouchEvent) => {
        const y = e.touches[0]?.clientY ?? 0;
        const delta = y - touchStartYRef.current;
        if (Math.abs(delta) <= 4) return;
        touchStartYRef.current = y;
        notifyUserScrollIntent();
        if (delta > 0) pauseAutoScroll();
        else moveTowardBottom();
    }, [pauseAutoScroll, notifyUserScrollIntent, moveTowardBottom]);

    const onPointerDown = useCallback((event: PointerEvent) => {
        notifyUserScrollIntent();
        if (followEnabledRef.current === false) pauseAutoScroll();
        const el = scrollerRef.current;
        // Native scrollbar events target the scroller itself, not its message rows.
        scrollbarDragRef.current = event.target === el;
        if (scrollbarDragRef.current) pauseAutoScroll();
        lastScrollTopRef.current = el?.scrollTop ?? 0;
    }, [notifyUserScrollIntent, pauseAutoScroll]);
    const onPointerUp = useCallback(() => { scrollbarDragRef.current = false; }, []);

    const onKeyDown = useCallback((e: KeyboardEvent) => {
        // Skip keys originating in editable targets — ArrowUp/Home are common cursor-nav
        // keys in textareas/inputs/contenteditable regions (chat input, code blocks) and
        // must not silently disable chat follow just because the user moved the caret.
        const target = e.target;
        if (target instanceof HTMLElement) {
            if (target.isContentEditable) return;
            const tag = target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        }
        if (
            e.key === 'PageUp'
            || e.key === 'PageDown'
            || e.key === 'ArrowUp'
            || e.key === 'ArrowDown'
            || e.key === 'Home'
            || e.key === 'End'
            || e.key === ' '
        ) {
            notifyUserScrollIntent();
        }
        // Keys that unambiguously move the view upward/away from the bottom.
        // PageDown/End/ArrowDown at bottom shouldn't break follow — those keep user at
        // bottom or move them toward it.
        if (e.key === 'PageUp' || e.key === 'ArrowUp' || e.key === 'Home' || (e.key === ' ' && e.shiftKey)) {
            pauseAutoScroll();
        } else if (e.key === 'PageDown' || e.key === 'ArrowDown' || e.key === 'End' || e.key === ' ') {
            moveTowardBottom();
        }
    }, [pauseAutoScroll, notifyUserScrollIntent, moveTowardBottom]);

    // Callback-ref pattern: stores the scroller for external consumers AND manages the
    // listener lifecycle. Virtuoso passes the scroller element (or Window) via its
    // `scrollerRef` prop; we only listen on HTMLElement scrollers. Keyboard needs to
    // listen at window level (scroller rarely receives keydown).
    const attachScroller = useCallback((el: HTMLElement | Window | null) => {
        const prev = scrollerRef.current;
        if (prev) {
            prev.removeEventListener('scroll', onScroll);
            prev.removeEventListener('wheel', onWheel);
            prev.removeEventListener('touchstart', onTouchStart);
            prev.removeEventListener('touchmove', onTouchMove);
            prev.removeEventListener('pointerdown', onPointerDown);
        }
        const next = el instanceof HTMLElement ? el : null;
        scrollerRef.current = next;
        scrollbarDragRef.current = false;
        lastScrollTopRef.current = next?.scrollTop ?? 0;
        if (next) {
            next.addEventListener('scroll', onScroll, { passive: true });
            next.addEventListener('wheel', onWheel, { passive: true });
            next.addEventListener('touchstart', onTouchStart, { passive: true });
            next.addEventListener('touchmove', onTouchMove, { passive: true });
            next.addEventListener('pointerdown', onPointerDown, { passive: true });
        }
    }, [onScroll, onWheel, onTouchStart, onTouchMove, onPointerDown]);

    useEffect(() => {
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerUp);
            clearForceDegradeTimer();
            const el = scrollerRef.current;
            if (el) {
                el.removeEventListener('scroll', onScroll);
                el.removeEventListener('wheel', onWheel);
                el.removeEventListener('touchstart', onTouchStart);
                el.removeEventListener('touchmove', onTouchMove);
                el.removeEventListener('pointerdown', onPointerDown);
            }
        };
    }, [onScroll, onWheel, onTouchStart, onTouchMove, onPointerDown, onPointerUp, onKeyDown, clearForceDegradeTimer]);

    return {
        virtuosoRef,
        scrollerRef,
        followEnabledRef,
        scrollToBottom,
        pauseAutoScroll,
        handleAtBottomChange,
        attachScroller,
    };
}
