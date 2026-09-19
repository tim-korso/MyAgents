import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useVirtuosoScroll } from './useVirtuosoScroll';

describe('useVirtuosoScroll user intent projection', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps follow intent when layout growth moves the bottom', () => {
    const { result } = renderHook(() => useVirtuosoScroll());
    act(() => result.current.handleAtBottomChange(false));
    expect(result.current.followEnabledRef.current).toBe(true);
  });

  it('does not treat near-bottom geometry as permission to resume after upward input', () => {
    const { result } = renderHook(() => useVirtuosoScroll());
    const scroller = document.createElement('div');
    act(() => result.current.attachScroller(scroller));
    scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -20 }));
    act(() => result.current.handleAtBottomChange(true));
    expect(result.current.followEnabledRef.current).toBe(false);
  });

  it('does not restore an old navigation decision over subsequent upward input', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useVirtuosoScroll());
    const scroller = document.createElement('div');
    act(() => result.current.attachScroller(scroller));
    act(() => result.current.pauseAutoScroll());
    scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -300 }));
    act(() => vi.advanceTimersByTime(2100));
    expect(result.current.followEnabledRef.current).toBe(false);
  });

  it('keeps a navigation destination in reading mode after the pause expires', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useVirtuosoScroll());
    const scroller = document.createElement('div');
    Object.defineProperties(scroller, { scrollHeight: { value: 1000 }, clientHeight: { value: 500 } });
    act(() => result.current.attachScroller(scroller));
    act(() => result.current.pauseAutoScroll());
    act(() => vi.advanceTimersByTime(2100));
    expect(result.current.followEnabledRef.current).toBe(false);
  });

  it('resumes only when downward input reaches the actual bottom', () => {
    const { result } = renderHook(() => useVirtuosoScroll());
    const scroller = document.createElement('div');
    Object.defineProperties(scroller, { scrollHeight: { value: 1000 }, clientHeight: { value: 500 } });
    act(() => result.current.attachScroller(scroller));
    scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -20 }));
    scroller.scrollTop = 480;
    scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: 10 }));
    scroller.dispatchEvent(new Event('scroll'));
    expect(result.current.followEnabledRef.current).toBe(false);
    scroller.scrollTop = 500;
    scroller.dispatchEvent(new Event('scroll'));
    expect(result.current.followEnabledRef.current).toBe(true);
  });

  it('detects scrollbar movement without confusing size growth with a drag', () => {
    const { result } = renderHook(() => useVirtuosoScroll());
    const scroller = document.createElement('div');
    Object.defineProperties(scroller, { scrollHeight: { value: 1000 }, clientHeight: { value: 500 } });
    scroller.scrollTop = 500;
    act(() => result.current.attachScroller(scroller));
    scroller.dispatchEvent(new PointerEvent('pointerdown'));
    scroller.scrollTop = 300;
    scroller.dispatchEvent(new Event('scroll'));
    expect(result.current.followEnabledRef.current).toBe(false);
    scroller.scrollTop = 500;
    scroller.dispatchEvent(new Event('scroll'));
    expect(result.current.followEnabledRef.current).toBe(true);
    window.dispatchEvent(new PointerEvent('pointerup'));
    act(() => result.current.handleAtBottomChange(false));
    expect(result.current.followEnabledRef.current).toBe(true);
  });

  it('handles touch direction reversals and ignores editable navigation keys', () => {
    const { result } = renderHook(() => useVirtuosoScroll());
    const scroller = document.createElement('div');
    Object.defineProperties(scroller, { scrollHeight: { value: 1000 }, clientHeight: { value: 500 } });
    scroller.scrollTop = 500;
    act(() => result.current.attachScroller(scroller));
    scroller.dispatchEvent(new TouchEvent('touchstart', { touches: [{ clientY: 100 } as Touch] }));
    scroller.dispatchEvent(new TouchEvent('touchmove', { touches: [{ clientY: 120 } as Touch] }));
    expect(result.current.followEnabledRef.current).toBe(false);
    scroller.dispatchEvent(new TouchEvent('touchmove', { touches: [{ clientY: 100 } as Touch] }));
    expect(result.current.followEnabledRef.current).toBe(true);
    const input = document.createElement('textarea');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(result.current.followEnabledRef.current).toBe(true);
    input.remove();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', shiftKey: true }));
    expect(result.current.followEnabledRef.current).toBe(false);
  });

  it('reports wheel, scrollbar pointer, and viewport keys without treating editable keys as scroll', () => {
    const onUserScrollIntent = vi.fn();
    const { result, unmount } = renderHook(() => useVirtuosoScroll({ onUserScrollIntent }));
    const scroller = document.createElement('div');
    act(() => result.current.attachScroller(scroller));

    scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -10 }));
    scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: 10 }));
    scroller.dispatchEvent(new PointerEvent('pointerdown'));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown' }));
    expect(onUserScrollIntent).toHaveBeenCalledTimes(4);

    const input = document.createElement('textarea');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
    expect(onUserScrollIntent).toHaveBeenCalledTimes(4);

    unmount();
    scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -10 }));
    expect(onUserScrollIntent).toHaveBeenCalledTimes(4);
  });

  it('lets immediate upward input escape force while downward wheel at bottom keeps following', () => {
    const { result, unmount } = renderHook(() => useVirtuosoScroll());
    const scroller = document.createElement('div');
    act(() => result.current.attachScroller(scroller));

    act(() => result.current.scrollToBottom());
    expect(result.current.followEnabledRef.current).toBe('force');

    scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: 10 }));
    expect(result.current.followEnabledRef.current).toBe(true);

    scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -10 }));
    expect(result.current.followEnabledRef.current).toBe(false);

    for (const key of ['PageUp', 'ArrowUp', 'Home']) {
      act(() => result.current.scrollToBottom());
      window.dispatchEvent(new KeyboardEvent('keydown', { key }));
      expect(result.current.followEnabledRef.current).toBe(false);
    }

    unmount();
  });

  it('lets downward input and scrollbar grabs take control while follow is still catching up', () => {
    const { result } = renderHook(() => useVirtuosoScroll());
    const scroller = document.createElement('div');
    Object.defineProperties(scroller, { scrollHeight: { value: 1000 }, clientHeight: { value: 500 } });
    scroller.scrollTop = 450;
    act(() => result.current.attachScroller(scroller));
    scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: 10 }));
    expect(result.current.followEnabledRef.current).toBe(false);
    scroller.scrollTop = 500;
    scroller.dispatchEvent(new Event('scroll'));
    expect(result.current.followEnabledRef.current).toBe(true);
    scroller.dispatchEvent(new PointerEvent('pointerdown'));
    expect(result.current.followEnabledRef.current).toBe(false);
  });
});
