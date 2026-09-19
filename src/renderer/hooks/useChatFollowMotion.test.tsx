import { act, cleanup, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatFollowMotion } from './useChatFollowMotion';

let now: number;
let frames: Map<number, FrameRequestCallback>;
let preference: EventTarget & { matches: boolean };

beforeEach(() => {
  now = 0;
  frames = new Map();
  let id = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++id, fn); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  preference = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal('matchMedia', () => preference);
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function advance(ms = 16) {
  act(() => {
    now += ms;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(fn => fn(now));
  });
}

function fixture(round = false) {
  const geometry = { height: 1000, viewport: 500 };
  const scroller = document.createElement('div');
  Object.defineProperties(scroller, {
    scrollHeight: { get: () => geometry.height },
    clientHeight: { get: () => geometry.viewport },
  });
  const scrollTo = vi.fn(({ top }: { top: number }) => { scroller.scrollTop = round ? Math.round(top) : top; });
  const props = {
    scroller,
    virtuosoRef: { current: { scrollTo } as unknown as VirtuosoHandle },
    followEnabledRef: { current: true as boolean | 'force' },
    admitted: true, recoveryFenced: false, sessionId: 'one', presentationGeneration: 0,
  };
  const hook = renderHook(useChatFollowMotion, { initialProps: props, wrapper: StrictMode });
  const grow = (amount: number) => { geometry.height += amount; act(() => hook.result.current()); };
  return { ...hook, props, scroller, geometry, scrollTo, grow };
}

describe('chat follow motion', () => {
  it('pins initial geometry, then crosses intermediate positions and settles without overshoot', () => {
    const f = fixture();
    expect(f.scroller.scrollTop).toBe(500);
    f.grow(200);
    expect(f.scroller.scrollTop).toBe(500);
    let previous = 500;
    for (let i = 0; i < 20; i++) {
      advance();
      expect(f.scroller.scrollTop).toBeGreaterThanOrEqual(previous);
      expect(f.scroller.scrollTop).toBeLessThanOrEqual(700);
      if (i === 0) expect(f.scroller.scrollTop).toBeLessThan(550);
      previous = f.scroller.scrollTop;
    }
    expect(f.scroller.scrollTop).toBe(700);
    expect(frames.size).toBe(0);
  });

  it('retargets one loop during rapid growth and keeps rounded scroll positions converging', () => {
    const f = fixture(true);
    for (let i = 0; i < 80; i++) {
      f.grow(12);
      // Duplicate commit/size notifications must neither restart nor multiply frames.
      act(() => { f.result.current(); f.result.current(); });
      expect(frames.size).toBe(1);
      advance();
      expect(f.geometry.height - 500 - f.scroller.scrollTop).toBeLessThan(60);
    }
    for (let i = 0; i < 20; i++) advance();
    expect(f.scroller.scrollTop).toBe(1460);
    expect(frames.size).toBe(0);
  });

  it('uses elapsed time consistently across display refresh rates', () => {
    const run = (ms: number) => {
      const f = fixture();
      f.grow(200);
      for (let t = 0; t < 96; t += ms) advance(ms);
      const position = f.scroller.scrollTop;
      f.unmount();
      return position;
    };
    expect(run(8)).toBeCloseTo(run(16), 6);
  });

  it('reads committed overflow when a virtualizer size notification precedes its DOM update', () => {
    const f = fixture();
    advance();
    act(() => f.result.current());
    // Virtuoso can publish totalListHeightChanged before its padding/footer
    // commit has made the new scrollHeight visible, particularly in WebKit.
    f.geometry.height += 200;
    advance();
    expect(f.scroller.scrollTop).toBeGreaterThan(500);
    expect(f.scroller.scrollTop).toBeLessThan(700);
    for (let i = 0; i < 20; i++) advance();
    expect(f.scroller.scrollTop).toBe(700);
    expect(frames.size).toBe(0);
  });

  it('stops before the next write when user intent changes, even without a React commit', () => {
    const f = fixture();
    f.grow(200);
    advance();
    f.props.followEnabledRef.current = false;
    f.scroller.scrollTop -= 30;
    const readerTop = f.scroller.scrollTop;
    f.scrollTo.mockClear();
    advance();
    f.grow(100);
    advance();
    expect(f.scrollTo).not.toHaveBeenCalled();
    expect(f.scroller.scrollTop).toBe(readerTop);
    expect(frames.size).toBe(0);
  });

  it.each(['admitted', 'recoveryFenced', 'sessionId', 'presentationGeneration'] as const)(
    'invalidates old motion across %s changes', key => {
      const f = fixture();
      f.grow(200);
      advance();
      const updated = { ...f.props, [key]: { admitted: false, recoveryFenced: true, sessionId: 'two', presentationGeneration: 1 }[key] };
      f.rerender(updated);
      f.scrollTo.mockClear();
      advance();
      expect(f.scrollTo).not.toHaveBeenCalled();
      expect(frames.size).toBe(0);
      // New/admitted layout pins once; no animated tour of the previous session.
      f.rerender({ ...updated, admitted: true, recoveryFenced: false });
      expect(f.scroller.scrollTop).toBe(700);
      f.unmount();
      expect(frames.size).toBe(0);
    },
  );

  it('obeys reduced motion immediately, including preference changes during animation', () => {
    const f = fixture();
    f.grow(200);
    advance();
    act(() => { preference.matches = true; preference.dispatchEvent(new Event('change')); });
    expect(f.scroller.scrollTop).toBe(700);
    advance();
    expect(frames.size).toBe(0);
    f.grow(200);
    expect(f.scroller.scrollTop).toBe(900);
    act(() => { preference.matches = false; preference.dispatchEvent(new Event('change')); });
    f.grow(100);
    expect(frames.size).toBe(1);
    f.unmount();
    expect(frames.size).toBe(0);
    f.scrollTo.mockClear();
    act(() => preference.dispatchEvent(new Event('change')));
    expect(f.scrollTo).not.toHaveBeenCalled();
  });

  it('handles large bursts, shrinking layout, forced navigation and zero geometry without a trailing animation', () => {
    const f = fixture();
    f.grow(2000);
    expect(f.scroller.scrollTop).toBe(2500);
    f.grow(100);
    advance();
    f.grow(-200);
    expect(f.scroller.scrollTop).toBe(2400);
    advance();
    expect(frames.size).toBe(0);
    f.props.followEnabledRef.current = 'force';
    f.grow(100);
    expect(f.scroller.scrollTop).toBe(2500);
    f.props.followEnabledRef.current = true;
    f.grow(100);
    f.geometry.viewport = 0;
    f.scrollTo.mockClear();
    advance();
    expect(f.scrollTo).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });
});
