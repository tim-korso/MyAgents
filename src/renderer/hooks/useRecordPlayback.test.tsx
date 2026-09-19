import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordTrackTimeline } from "@/../shared/types/record";
import { useRecordPlayback } from "./useRecordPlayback";

let now = 0;

function source(
  name: string,
  recordStartMs = 0,
  recordEndMs = 6000,
  ready = true,
) {
  let position = 0;
  let observedAt = now;
  let rate = 1;
  const media = {
    duration: (recordEndMs - recordStartMs) / 1000,
    muted: false,
    paused: true,
    seeking: false,
    readyState: ready ? 4 : 0,
    get currentTime() {
      if (!media.paused && !media.seeking && media.readyState >= 3) {
        position = Math.min(
          media.duration,
          position + ((now - observedAt) / 1000) * rate,
        );
      }
      observedAt = now;
      return position;
    },
    set currentTime(value: number) {
      position = value;
      observedAt = now;
    },
    get playbackRate() {
      return rate;
    },
    set playbackRate(value: number) {
      void media.currentTime;
      rate = value;
    },
    pause: vi.fn(() => {
      void media.currentTime;
      media.paused = true;
    }),
    play: vi.fn(() => {
      observedAt = now;
      media.paused = false;
      return Promise.resolve();
    }),
  };
  const timeline: RecordTrackTimeline = {
    spans: [
      {
        sourceStart: 0,
        sourceEnd: (recordEndMs - recordStartMs) * 16,
        recordStart: recordStartMs * 16,
        recordEnd: recordEndMs * 16,
        quality: "clock",
        discontinuity: false,
      },
    ],
  };
  return {
    media,
    ref: { current: media as unknown as HTMLAudioElement },
    src: name,
    timeline,
  };
}

describe("Record playback transport", () => {
  beforeEach(() => {
    now = 0;
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  function setup(sources: ReturnType<typeof source>[], durationMs = 6000) {
    const callbacks = {
      onPosition: vi.fn(),
      onPlaying: vi.fn(),
      onStarted: vi.fn(),
      onFinished: vi.fn(),
      onError: vi.fn(),
    };
    return {
      ...renderHook((props) => useRecordPlayback({ ...callbacks, ...props }), {
        initialProps: { sources, durationMs },
      }),
      callbacks,
    };
  }
  async function advance(ms: number) {
    for (let elapsed = 0; elapsed < ms; elapsed += 10) {
      const step = Math.min(10, ms - elapsed);
      await act(async () => {
        now += step;
        vi.advanceTimersByTime(step);
      });
    }
  }

  it("lets an asynchronous seek finish and produces audio instead of chasing the wall clock", async () => {
    const mic = source("mic");
    const media = mic.media as typeof mic.media & { seeking: boolean };
    media.readyState = 4;
    media.seeking = false;
    let currentTime = 0;
    let seeks = 0;
    let audibleMs = 0;
    let seekTimer: ReturnType<typeof setTimeout> | undefined;
    Object.defineProperty(media, "currentTime", {
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
        seeks += 1;
        media.seeking = true;
        clearTimeout(seekTimer);
        seekTimer = setTimeout(() => {
          media.seeking = false;
        }, 80);
      },
    });
    const decoder = setInterval(() => {
      if (!media.paused && !media.seeking) {
        currentTime += 0.01 * media.playbackRate;
        if (!media.muted) audibleMs += 10;
      }
    }, 10);
    const { result, callbacks, unmount } = setup([mic]);
    act(() => result.current.seek(1500));
    await act(async () => result.current.toggle());
    for (let elapsed = 0; elapsed < 1000; elapsed += 10) await advance(10);
    expect(audibleMs).toBeGreaterThan(700);
    expect(seeks).toBeLessThan(5);
    expect(result.current.getPosition()).toBeLessThanOrEqual(
      currentTime * 1000 + 50,
    );
    expect(callbacks.onError).not.toHaveBeenCalled();
    unmount();
    clearInterval(decoder);
    clearTimeout(seekTimer);
  });

  it("holds an early decoder while its mixed companion prepares", async () => {
    const mic = source("mic");
    const system = source("system");
    let release: () => void = () => undefined;
    const normalPlay = system.media.play.getMockImplementation()!;
    system.media.play.mockImplementationOnce(() => {
      normalPlay();
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const { result, unmount } = setup([mic, system]);
    await act(async () => result.current.toggle());
    await advance(800);
    expect(mic.media.currentTime).toBeCloseTo(0);
    expect(result.current.getPosition()).toBeCloseTo(0);
    // The pending decoder has not produced samples yet.
    system.media.currentTime = 0;
    await act(async () => release());
    await advance(500);
    expect(
      Math.abs(mic.media.currentTime - system.media.currentTime),
    ).toBeLessThan(0.05);
    expect(result.current.getPosition()).toBeGreaterThan(400);
    unmount();
  });

  it("freezes both tracks when one buffers and resumes without skipping audio", async () => {
    const mic = source("mic");
    const system = source("system");
    const { result, callbacks, unmount } = setup([mic, system]);
    await act(async () => result.current.toggle());
    await advance(500);
    let ready: () => void = () => undefined;
    system.media.readyState = 2;
    system.media.play.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          ready = () => {
            system.media.readyState = 4;
            system.media.paused = false;
            resolve();
          };
        }),
    );
    await advance(100);
    const heldAt = result.current.getPosition();
    await advance(1000);
    expect(result.current.getPosition()).toBeCloseTo(heldAt);
    expect(mic.media.muted).toBe(true);
    await act(async () => ready());
    await advance(500);
    expect(result.current.getPosition()).toBeGreaterThan(heldAt + 400);
    expect(callbacks.onError).not.toHaveBeenCalled();
    unmount();
  });

  it("seeks legacy audio, pauses and resumes from decoded position, then replays after ending", async () => {
    const mic = { ...source("legacy"), timeline: undefined };
    const callbacks = {
      onPosition: vi.fn(),
      onPlaying: vi.fn(),
      onStarted: vi.fn(),
      onFinished: vi.fn(),
      onError: vi.fn(),
    };
    const { result, unmount } = renderHook(() =>
      useRecordPlayback({ ...callbacks, sources: [mic], durationMs: 6000 }),
    );
    act(() => result.current.seek(4000));
    await act(async () => result.current.toggle());
    await advance(500);
    act(() => result.current.pause());
    const pausedAt = result.current.getPosition();
    await advance(1000);
    expect(result.current.getPosition()).toBeCloseTo(pausedAt);
    await act(async () => result.current.toggle());
    await advance(1600);
    expect(callbacks.onFinished).toHaveBeenCalledTimes(1);
    await act(async () => result.current.toggle());
    await advance(500);
    expect(result.current.getPosition()).toBeCloseTo(500, 0);
    expect(callbacks.onError).not.toHaveBeenCalled();
    unmount();
  });

  it.each([false, true])(
    "finishes legacy trailing silence with a longer companion: %s",
    async (mixed) => {
      const mic = source("legacy-mic", 0, 1000);
      const system = source("legacy-system", 0, 3000);
      const sources = (mixed ? [mic, system] : [mic]).map(({ ref, src }) => ({
        ref,
        src,
      }));
      const onFinished = vi.fn();
      const { result, unmount } = renderHook(() =>
        useRecordPlayback({
          sources,
          durationMs: 3000,
          onPosition: vi.fn(),
          onPlaying: vi.fn(),
          onStarted: vi.fn(),
          onFinished,
          onError: vi.fn(),
        }),
      );
      await act(async () => result.current.toggle());
      await advance(2000);
      expect(result.current.getPosition()).toBeGreaterThan(1900);
      expect(mic.media.paused).toBe(true);
      await advance(1100);
      expect(result.current.getPosition()).toBeCloseTo(3000);
      expect(onFinished).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      await act(async () => result.current.toggle());
      await advance(300);
      expect(result.current.getPosition()).toBeCloseTo(300, 0);
      unmount();
    },
  );

  it("keeps the Record clock across late metadata and the earlier source ending", async () => {
    const mic = source("mic", 0, 3000);
    const system = source("system", 2000, 6000, false);
    const { result, callbacks, unmount } = setup([mic, system]);
    await act(async () => result.current.toggle());
    await advance(1000);
    expect(result.current.getPosition()).toBeCloseTo(1000);
    system.media.readyState = 4;
    act(() => result.current.metadataReady());
    expect(mic.media.currentTime).toBeCloseTo(1);
    expect(mic.media.muted).toBe(false);
    expect(system.media.paused).toBe(true);
    await advance(1000);
    expect(system.media.play).toHaveBeenCalled();
    expect(system.media.currentTime).toBeCloseTo(0);
    await advance(1500);
    expect(mic.media.paused).toBe(true);
    expect(system.media.paused).toBe(false);
    expect(system.media.currentTime).toBeCloseTo(1.5);
    expect(callbacks.onFinished).not.toHaveBeenCalled();
    await advance(2550);
    expect(callbacks.onFinished).toHaveBeenCalledTimes(1);
    expect(system.media.paused).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    unmount();
  });

  it("waits at the requested position for metadata and preserves seeks made before Record loading", async () => {
    const mic = source("mic", 0, 6000, false);
    const { result, rerender, unmount } = setup([mic], 0);
    act(() => result.current.seek(2500));
    rerender({ sources: [mic], durationMs: 6000 });
    await act(async () => result.current.toggle());
    await advance(1000);
    expect(mic.media.play).not.toHaveBeenCalled();
    expect(result.current.getPosition()).toBeCloseTo(2500);
    mic.media.readyState = 4;
    await act(async () => result.current.metadataReady());
    expect(mic.media.currentTime).toBeCloseTo(2.5);
    await advance(500);
    expect(result.current.getPosition()).toBeCloseTo(3000);
    unmount();
  });

  it("revokes pending starts on seek, pause and source replacement without leaving detached audio playing", async () => {
    const mic = source("mic");
    const next = source("other");
    let finishPlay: () => void = () => undefined;
    mic.media.play.mockImplementation(() => {
      mic.media.paused = false;
      return new Promise<void>((resolve) => {
        finishPlay = resolve;
      });
    });
    const { result, rerender, callbacks, unmount } = setup([mic]);
    act(() => result.current.toggle());
    const stale = finishPlay;
    act(() => result.current.seek(3000));
    const current = finishPlay;
    await act(async () => stale());
    expect(callbacks.onStarted).not.toHaveBeenCalled();
    expect(mic.media.muted).toBe(true);
    await act(async () => current());
    expect(mic.media.currentTime).toBeCloseTo(3);
    expect(mic.media.muted).toBe(false);
    rerender({ sources: [next], durationMs: 6000 });
    expect(mic.media.paused).toBe(true);
    expect(next.media.paused).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => result.current.toggle());
    act(() => result.current.pause());
    await advance(1000);
    expect(next.media.paused).toBe(true);
    expect(result.current.getPosition()).toBeCloseTo(3000);
    unmount();
  });

  it("continues through archive gaps at the mapped rate and ignores identical inventory refreshes", async () => {
    const mic = source("mic");
    mic.timeline.spans = [
      {
        sourceStart: 0,
        sourceEnd: 16000,
        recordStart: 16000,
        recordEnd: 48000,
        quality: "clock",
        discontinuity: false,
      },
      {
        sourceStart: 16000,
        sourceEnd: 32000,
        recordStart: 48000,
        recordEnd: 64000,
        quality: "gap",
        discontinuity: true,
      },
      {
        sourceStart: 32000,
        sourceEnd: 64000,
        recordStart: 64000,
        recordEnd: 96000,
        quality: "clock",
        discontinuity: true,
      },
    ];
    const { result, rerender, unmount } = setup([mic]);
    await act(async () => result.current.toggle());
    expect(mic.media.paused).toBe(true);
    await advance(1500);
    expect(mic.media.currentTime).toBeCloseTo(0.25);
    expect(mic.media.playbackRate).toBe(0.5);
    const pauses = mic.media.pause.mock.calls.length;
    rerender({
      sources: [{ ...mic, timeline: structuredClone(mic.timeline) }],
      durationMs: 6000,
    });
    expect(mic.media.pause).toHaveBeenCalledTimes(pauses);
    await advance(2000);
    expect(mic.media.paused).toBe(true);
    expect(mic.media.muted).toBe(true);
    await advance(1000);
    expect(mic.media.paused).toBe(false);
    expect(mic.media.currentTime).toBeCloseTo(2.5);
    expect(mic.media.playbackRate).toBe(1);
    unmount();
    expect(mic.media.paused).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
