/**
 * SeekBar — a draggable audio progress track (click + pointer-drag to seek).
 *
 * Extracted (PRD 0.2.31) so the compact AudioPlayerBar and the giant
 * ToolAudioAttachment player share one seek implementation. Pure presentational:
 * the parent owns the audio state and maps `onSeek(ratio)` → `seek(ratio * duration)`.
 */
import { useCallback, useRef } from 'react';

interface SeekBarProps {
  /** Fill ratio 0..1. */
  ratio: number;
  /** Whether the track responds to click/drag (i.e. audio is loaded with a duration). */
  seekable: boolean;
  /** Called with the new ratio (0..1) on click / drag. */
  onSeek: (ratio: number) => void;
  className?: string;
  /**
   * Track (unfilled) background class. Defaults to the faint `--line`; pass a
   * more visible token (e.g. `bg-[var(--paper-inset)]`) when the bar sits on an
   * elevated card so the groove reads as a real progress track, not empty space.
   */
  trackClass?: string;
}

export default function SeekBar({ ratio, seekable, onSeek, className, trackClass = 'bg-[var(--line)]' }: SeekBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const seekFromEvent = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el || !seekable) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    onSeek(Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)));
  }, [seekable, onSeek]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    seekFromEvent(e.clientX);
  }, [seekFromEvent]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!seekable) return;
    e.preventDefault();
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    seekFromEvent(e.clientX);
  }, [seekable, seekFromEvent]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    seekFromEvent(e.clientX);
  }, [seekFromEvent]);

  const handlePointerUp = useCallback(() => {
    draggingRef.current = false;
  }, []);

  const pct = `${Math.max(0, Math.min(1, ratio)) * 100}%`;

  return (
    <div
      ref={trackRef}
      className={`relative h-1.5 rounded-full ${trackClass} ${seekable ? 'cursor-pointer' : ''} ${className ?? ''}`}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)]"
        // eslint-disable-next-line react-hooks/refs -- draggingRef read during render is intentional: transition must be instant while dragging to avoid lag
        style={{ width: pct, transition: draggingRef.current ? 'none' : 'width 200ms' }}
      />
      {seekable && (
        <div
          className="absolute top-1/2 size-3 -translate-y-1/2 rounded-full bg-[var(--accent)] shadow-sm ring-2 ring-[var(--paper-elevated)]"
          style={{ left: `calc(${pct} - 6px)` }}
        />
      )}
    </div>
  );
}
