import { useCallback, useLayoutEffect, useRef } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';

interface ChatFollowMotionOptions {
  scroller: HTMLElement | null;
  virtuosoRef: React.RefObject<VirtuosoHandle | null>;
  followEnabledRef: React.MutableRefObject<boolean | 'force'>;
  admitted: boolean;
  recoveryFenced: boolean;
  sessionId: string | null | undefined;
  presentationGeneration: number;
}

/** Motion only: follow intent and restoration remain owned by the scroll controller. */
export function useChatFollowMotion({
  scroller, virtuosoRef, followEnabledRef, admitted, recoveryFenced,
  sessionId, presentationGeneration,
}: ChatFollowMotionOptions) {
  const alignRef = useRef<() => void>(() => {});
  const alignFollowingViewport = useCallback(() => alignRef.current(), []);

  useLayoutEffect(() => {
    if (!scroller || !admitted || recoveryFenced) return;
    const motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let frame: number | null = null;
    let initial = true;
    let position = scroller.scrollTop;
    let velocity = 0;
    let lastTime = 0;

    const cancel = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      velocity = 0;
    };
    const canFollow = () => !!followEnabledRef.current && scroller.clientHeight > 0;
    const bottom = () => Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const write = (top: number) => virtuosoRef.current?.scrollTo({ top, behavior: 'auto' });
    const needsImmediate = (gap: number) => initial || motionPreference?.matches
      || followEnabledRef.current === 'force' || gap < 0
      // A whole new screen should not leave the latest output trailing offscreen.
      || gap > Math.max(480, scroller.clientHeight);

    const tick = (now: number) => {
      frame = null;
      if (!canFollow()) { cancel(); return; }
      const target = bottom();
      const actual = scroller.scrollTop;
      const gap = target - actual;
      if (needsImmediate(gap) || gap <= 1) {
        cancel();
        if (gap !== 0) write(target);
        return;
      }
      // Keep subpixel progress on engines that round scrollTop, but accept real
      // virtualizer corrections. Never integrate against stale estimated heights.
      if (Math.abs(position - actual) > 1) { position = actual; velocity = 0; }
      const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      // Exact critically damped spring step (32/s): continuous velocity as the
      // target grows, no overshoot, and a short settling tail without frame-rate bias.
      const error = position - target;
      const momentum = velocity + 32 * error;
      const decay = Math.exp(-32 * dt);
      position = Math.min(target, Math.max(actual, target + (error + momentum * dt) * decay));
      velocity = (velocity - 32 * momentum * dt) * decay;
      write(position);
      frame = requestAnimationFrame(tick);
    };

    const align = () => {
      if (!canFollow()) { cancel(); return; }
      const target = bottom();
      const gap = target - scroller.scrollTop;
      const immediate = needsImmediate(gap);
      initial = false;
      if (immediate) {
        cancel();
        if (gap !== 0) write(target);
      }
      // A size notification can precede Virtuoso's padding/footer DOM commit.
      // Always reconcile that notification on the next frame, even if geometry
      // still says "at bottom" now. This is one coalesced read, not idle polling.
      if (frame === null) {
        position = scroller.scrollTop;
        velocity = 0;
        lastTime = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };

    alignRef.current = align;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(align);
    observer?.observe(scroller);
    motionPreference?.addEventListener('change', align);
    align();
    return () => {
      alignRef.current = () => {};
      cancel();
      observer?.disconnect();
      motionPreference?.removeEventListener('change', align);
    };
  }, [scroller, virtuosoRef, followEnabledRef, admitted, recoveryFenced, sessionId, presentationGeneration]);

  // React commits can precede virtualizer size notifications. Both update the
  // same running animation; neither starts a separate browser smooth scroll.
  useLayoutEffect(alignFollowingViewport);
  return alignFollowingViewport;
}
