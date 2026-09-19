import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import type { RecordTrackTimeline } from "@/../shared/types/record";
import {
  recordPlaybackPosition,
  sourcePlaybackRecordMs,
} from "@/utils/recordPlayback";

interface PlaybackSource {
  ref: RefObject<HTMLAudioElement | null>;
  src: string;
  timeline?: RecordTrackTimeline;
}
interface Options {
  sources: PlaybackSource[];
  durationMs: number;
  onPosition: (recordMs: number) => void;
  onPlaying: (playing: boolean) => void;
  onStarted: () => void;
  onFinished: () => void;
  onError: () => void;
}

/** The existing Record detail owns this transport. Original media elements
 * have different clocks; a single Record clock coordinates seeks, silent gaps,
 * drift rates and the period after one source has ended. */
export function useRecordPlayback(options: Options) {
  const optionsRef = useRef(options);
  // Media events and timers observe the committed UI. Layout runs before
  // browser callbacks can observe a new source, without exposing an abandoned
  // concurrent render to an already running transport.
  useLayoutEffect(() => {
    optionsRef.current = options;
  });
  const transport = useRef({
    recordMs: 0,
    startedAt: null as number | null,
    wanted: false,
    pending: false,
    epoch: 0,
    mounted: false,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    lastPositionAt: -Infinity,
    boundaryMs: Infinity,
    clockSource: null as {
      source: PlaybackSource;
      audio: HTMLAudioElement;
    } | null,
  });
  const tickRef = useRef<() => void>(() => undefined);

  const clockPosition = useCallback(() => {
    const state = transport.current;
    let position = state.recordMs;
    if (state.startedAt !== null) {
      const leader = state.clockSource;
      if (leader) {
        // currentTime is a requested target during seeking, not decoded progress.
        // Waiting/stalled media keeps its real clock still; never chase it with
        // another seek. The captured element also fences a replaced ref.
        if (
          !leader.audio.seeking &&
          leader.audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        ) {
          position = Math.max(
            position,
            sourcePlaybackRecordMs(
              leader.source.timeline,
              leader.audio.currentTime,
            ),
          );
        }
      } else {
        // Only a genuine gap has no media clock. Stop at its next boundary so
        // a delayed timer cannot skip the beginning of the following source.
        position += Math.max(0, performance.now() - state.startedAt);
      }
      position = Math.min(position, state.boundaryMs);
    }
    return optionsRef.current.durationMs > 0
      ? Math.min(optionsRef.current.durationMs, position)
      : position;
  }, []);

  const pause = useCallback(() => {
    const state = transport.current;
    state.recordMs = clockPosition();
    state.startedAt = null;
    state.clockSource = null;
    state.wanted = false;
    state.pending = false;
    state.epoch += 1;
    if (state.timer !== undefined) clearTimeout(state.timer);
    state.timer = undefined;
    for (const source of optionsRef.current.sources)
      source.ref.current?.pause();
    optionsRef.current.onPlaying(false);
    optionsRef.current.onPosition(state.recordMs);
  }, [clockPosition]);

  const fail = useCallback(() => {
    pause();
    optionsRef.current.onError();
  }, [pause]);

  const positionSources = useCallback(
    (
      recordMs: number,
      positioning: "none" | "settle" | "replace",
      muted: boolean,
    ) => {
      return optionsRef.current.sources.map((source) => {
        const audio = source.ref.current;
        const duration =
          audio && Number.isFinite(audio.duration) ? audio.duration : Infinity;
        const position = recordPlaybackPosition(
          source.timeline,
          recordMs,
          duration,
        );
        if (audio) {
          audio.muted = muted || !position.audible;
          if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
            if (position.playbackRate < 0.0625 || position.playbackRate > 16)
              throw new Error("Unsupported Record playback rate");
            // The capture map already owns each source's clock slope. Keep
            // that rate stable: frequent rate writes also disrupt WebKit's
            // decoder clock, just like repeated currentTime assignments.
            if (audio.playbackRate !== position.playbackRate) {
              audio.playbackRate = position.playbackRate;
            }
            if (
              positioning !== "none" &&
              (positioning === "replace" || !audio.seeking) &&
              Math.abs(audio.currentTime - position.sourceSeconds) > 0.001
            ) {
              audio.currentTime = position.sourceSeconds;
            }
          }
          if (!position.audible && !audio.paused) audio.pause();
        }
        return { source, audio, position };
      });
    },
    [],
  );

  const startAt = useCallback(
    (recordMs: number) => {
      const state = transport.current;
      if (!state.mounted || !state.wanted || state.pending) return;
      state.recordMs = recordMs;
      state.startedAt = null;
      state.clockSource = null;
      try {
        // A source entering after a gap may need asynchronous positioning. Hold
        // the other track at this Record position while the start settles.
        for (const source of optionsRef.current.sources) {
          const audio = source.ref.current;
          if (audio && !audio.paused) audio.pause();
        }
        const sources = positionSources(recordMs, "settle", true);
        // Preload metadata owns readiness. The clock stays at this exact Record
        // position until all currently audible sources can be positioned.
        if (
          sources.some(
            ({ audio, position }) =>
              position.audible &&
              (!audio || audio.readyState < HTMLMediaElement.HAVE_METADATA),
          )
        )
          return;
        const epoch = state.epoch;
        state.pending = true;
        const audible = sources.filter(({ position }) => position.audible);
        const current = () =>
          state.mounted && state.wanted && state.epoch === epoch;
        // A play promise can settle much earlier for one decoder. Park each
        // ready track while muted so it cannot run ahead behind the start gate.
        // Once all are ready, resume the already-positioned elements together.
        const plays = audible.map(async ({ audio }) => {
          await audio!.play();
          if (current() && audible.length > 1) audio!.pause();
        });
        void Promise.all(plays)
          .then(async () => {
            if (!current()) return;
            await Promise.all(
              audible.map(({ audio }) =>
                audio!.paused ? audio!.play() : Promise.resolve(),
              ),
            );
          })
          .then(() => {
            if (!state.mounted || !state.wanted || state.epoch !== epoch)
              return;
            const leader = sources.find(
              ({ audio, position }) => audio && position.audible,
            );
            state.clockSource = leader
              ? { source: leader.source, audio: leader.audio! }
              : null;
            state.boundaryMs = Math.min(
              ...sources.map(({ position }) => position.boundaryMs),
            );
            // play() resolving is not permission to seek again: that would abort
            // decoding immediately after it became ready.
            positionSources(recordMs, "none", false);
            state.pending = false;
            state.startedAt = performance.now();
            optionsRef.current.onStarted();
            tickRef.current();
          })
          .catch(() => {
            if (state.mounted && state.wanted && state.epoch === epoch) fail();
          });
      } catch {
        fail();
      }
    },
    [fail, positionSources],
  );

  const tick = useCallback(() => {
    const state = transport.current;
    if (state.timer !== undefined) clearTimeout(state.timer);
    state.timer = undefined;
    if (!state.mounted || !state.wanted) return;
    const recordMs = clockPosition();
    state.recordMs = recordMs;
    if (state.startedAt !== null) state.startedAt = performance.now();
    if (recordMs >= optionsRef.current.durationMs) {
      pause();
      optionsRef.current.onFinished();
      return;
    }
    if (!state.pending) {
      try {
        const sources = positionSources(
          recordMs,
          "none",
          state.startedAt === null,
        );
        if (
          state.startedAt === null ||
          sources.some(
            ({ audio, position }) =>
              position.audible &&
              (!audio ||
                audio.paused ||
                audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA),
          )
        ) {
          startAt(recordMs);
        } else {
          const leader = sources.find(
            ({ audio, position }) => audio && position.audible,
          );
          state.clockSource = leader
            ? { source: leader.source, audio: leader.audio! }
            : null;
          state.boundaryMs = Math.min(
            ...sources.map(({ position }) => position.boundaryMs),
          );
        }
        if (performance.now() - state.lastPositionAt >= 50) {
          optionsRef.current.onPosition(recordMs);
          state.lastPositionAt = performance.now();
        }
      } catch {
        fail();
        return;
      }
    }
    if (state.wanted) state.timer = setTimeout(() => tickRef.current(), 25);
  }, [clockPosition, fail, pause, positionSources, startAt]);
  useLayoutEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  const seek = useCallback(
    (recordMs: number) => {
      const state = transport.current;
      state.epoch += 1;
      state.pending = false;
      state.recordMs = Math.max(
        0,
        optionsRef.current.durationMs > 0
          ? Math.min(recordMs, optionsRef.current.durationMs)
          : recordMs,
      );
      state.startedAt = null;
      state.clockSource = null;
      // An explicit new seek supersedes an older seek once. Background ticks
      // never overwrite an in-flight seek.
      for (const source of optionsRef.current.sources)
        source.ref.current?.pause();
      try {
        positionSources(state.recordMs, "replace", state.wanted);
      } catch {
        fail();
        return;
      }
      optionsRef.current.onPosition(state.recordMs);
      if (state.wanted) tickRef.current();
    },
    [fail, positionSources],
  );

  const getPosition = useCallback(() => {
    const state = transport.current;
    const source = optionsRef.current.sources[0];
    const audio = source?.ref.current;
    // Native/external seeks made while paused can be adopted only when the
    // source actually represents the current media position, not in a gap.
    if (
      !state.wanted &&
      audio &&
      audio.readyState >= HTMLMediaElement.HAVE_METADATA
    ) {
      try {
        const duration = Number.isFinite(audio.duration)
          ? audio.duration
          : Infinity;
        if (
          recordPlaybackPosition(source.timeline, state.recordMs, duration)
            .audible
        ) {
          return Math.min(
            optionsRef.current.durationMs,
            sourcePlaybackRecordMs(source.timeline, audio.currentTime),
          );
        }
      } catch {
        return state.recordMs;
      }
    }
    return clockPosition();
  }, [clockPosition]);

  const toggle = useCallback(() => {
    const state = transport.current;
    if (state.wanted) {
      pause();
      return;
    }
    if (
      optionsRef.current.sources.length === 0 ||
      optionsRef.current.durationMs <= 0
    )
      return;
    state.recordMs = getPosition();
    if (state.recordMs >= optionsRef.current.durationMs) state.recordMs = 0;
    state.wanted = true;
    state.epoch += 1;
    optionsRef.current.onPlaying(true);
    tickRef.current();
  }, [getPosition, pause]);

  const metadataReady = useCallback(() => {
    const state = transport.current;
    // Metadata for a late secondary track must not seek the playing leader.
    if (state.wanted) tickRef.current();
    else
      try {
        positionSources(state.recordMs, "settle", false);
      } catch {
        fail();
      }
  }, [fail, positionSources]);

  const timeUpdated = useCallback(() => {
    if (transport.current.wanted) {
      tickRef.current();
      return;
    }
    const recordMs = getPosition();
    transport.current.recordMs = recordMs;
    optionsRef.current.onPosition(recordMs);
  }, [getPosition]);

  // Identical inventories read again after a note edit are the same resource;
  // object identity must not pause playback. Source/map changes revoke pending
  // play promises and retain the user's Record position for the next seek.
  const sourceIdentity = JSON.stringify(
    options.sources.map(({ src, timeline }) => ({ src, timeline })),
  );
  useEffect(() => {
    const state = transport.current;
    const elements = optionsRef.current.sources.map(
      (source) => source.ref.current,
    );
    state.mounted = true;
    metadataReady();
    return () => {
      pause();
      state.mounted = false;
      // A source may have been removed/replaced before this cleanup. Its old
      // element can still play after detaching from the DOM.
      for (const element of elements) element?.pause();
    };
  }, [sourceIdentity, metadataReady, pause]);

  return { seek, toggle, pause, getPosition, metadataReady, timeUpdated, fail };
}
