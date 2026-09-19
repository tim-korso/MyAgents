import { useEffect, useRef, useState } from 'react';

import {
  buildKeyEvent,
  buildMouseEvent,
  cdpModifiers,
  fetchManagedFrame,
  leaseViewToken,
  openManagedView,
  closeManagedView,
  printableText,
  sendManagedInput,
  MANAGED_FRAME_POLL_MS,
} from './managedBrowserView';
import type { ViewOwner } from './managedBrowserView';

/**
 * Renders the Agent's managed Chromium inside the split panel.
 *
 * The panel used to host a wry/WKWebView child that Playwright could never
 * reach, so the user and the Agent were looking at two different browsers.
 * Here the panel instead paints the managed browser's CDP screencast into a
 * canvas and feeds panel input back through the same CDP session — one
 * browser, one login, one page.
 *
 * The native webview path stays available: if the managed browser cannot be
 * reached (Chromium resource not installed, or the managed MCP not selected
 * for this session) this component reports `unavailable` and the panel keeps
 * its previous behaviour.
 */

export type ManagedViewState = 'idle' | 'connecting' | 'live' | 'unavailable';

interface ManagedBrowserCanvasProps {
  /** Sizing source; the canvas follows this element's box. */
  containerRef: React.RefObject<HTMLElement | null>;
  /**
   * Session identity used to lease the capability. The lease must be issued by
   * this session's own Sidecar, so the panel needs the identity even though the
   * Browser Host itself is global.
   */
  owner: ViewOwner | null;
  /** Whether frames should be pulled and input forwarded right now. */
  isVisible: boolean;
  onStateChange?: (state: ManagedViewState) => void;
}

/** Fit the canvas to its container without upscaling past the frame's own resolution. */
export function fitFrameToBox(
  frame: { width: number; height: number },
  box: { width: number; height: number },
): { width: number; height: number } {
  if (frame.width <= 0 || frame.height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(box.width / frame.width, box.height / frame.height);
  if (!Number.isFinite(scale) || scale <= 0) return { width: frame.width, height: frame.height };
  return {
    width: Math.max(1, Math.round(frame.width * Math.min(scale, 1))),
    height: Math.max(1, Math.round(frame.height * Math.min(scale, 1))),
  };
}

/** Container box → page coordinates, so a click lands where the user aimed. */
export function toPagePoint(
  event: { clientX: number; clientY: number },
  box: { left: number; top: number; width: number; height: number },
  frame: { width: number; height: number },
): { x: number; y: number } {
  if (box.width <= 0 || box.height <= 0) return { x: 0, y: 0 };
  const scaleX = frame.width / box.width;
  const scaleY = frame.height / box.height;
  return {
    x: Math.max(0, Math.min(frame.width, (event.clientX - box.left) * scaleX)),
    y: Math.max(0, Math.min(frame.height, (event.clientY - box.top) * scaleY)),
  };
}

export default function ManagedBrowserCanvas({
  containerRef,
  owner,
  isVisible,
  onStateChange,
}: ManagedBrowserCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<ManagedViewState>('idle');

  // Mirror state outward without making the callback a lifecycle dependency.
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => { onStateChangeRef.current = onStateChange; }, [onStateChange]);
  useEffect(() => { onStateChangeRef.current?.(state); }, [state]);

  const viewIdRef = useRef<string | null>(null);
  const frameSeqRef = useRef(0);
  const frameSizeRef = useRef({ width: 0, height: 0 });

  // Depend on identity fields, never the object: a caller passing a fresh
  // `{sessionId, tabId}` literal each render would otherwise tear down and
  // reopen the view on every parent re-render.
  const ownerSessionId = owner?.sessionId ?? '';
  const ownerTabId = owner?.tabId ?? '';

  // ── Open the view and pull frames ──
  useEffect(() => {
    if (!isVisible || !ownerSessionId || !ownerTabId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let viewId: string | null = null;

    const paint = (image: HTMLImageElement) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext('2d');
      if (!context) return;
      const box = containerRef.current?.getBoundingClientRect();
      const fitted = fitFrameToBox(
        { width: image.naturalWidth, height: image.naturalHeight },
        { width: box?.width ?? image.naturalWidth, height: box?.height ?? image.naturalHeight },
      );
      if (canvas.width !== fitted.width || canvas.height !== fitted.height) {
        canvas.width = fitted.width;
        canvas.height = fitted.height;
      }
      context.drawImage(image, 0, 0, fitted.width, fitted.height);
    };

    const poll = async () => {
      if (cancelled || !viewId) return;
      try {
        const result = await fetchManagedFrame(viewId, frameSeqRef.current);
        if (cancelled) return;
        if (result.frame) {
          frameSeqRef.current = result.frame.seq;
          frameSizeRef.current = { width: result.frame.width, height: result.frame.height };
          const image = new Image();
          image.onload = () => { if (!cancelled) paint(image); };
          image.src = `data:image/jpeg;base64,${result.frame.data}`;
        }
      } catch (error) {
        if (!cancelled) {
          // A closed or evicted view is terminal, not a transient hiccup:
          // reconnecting here would fight the eviction that just happened.
          const message = error instanceof Error ? error.message : '';
          if (message.includes('BROWSER_VIEW_NOT_FOUND')) {
            setState('unavailable');
            return;
          }
          console.warn('[managed-browser] frame pull failed:', error);
        }
      }
      if (!cancelled) timer = setTimeout(() => void poll(), MANAGED_FRAME_POLL_MS);
    };

    void (async () => {
      setState('connecting');
      try {
        const box = containerRef.current?.getBoundingClientRect();
        const token = await leaseViewToken({ sessionId: ownerSessionId, tabId: ownerTabId });
        if (cancelled) return;
        viewId = await openManagedView(token, Math.round(box?.width ?? 0), Math.round(box?.height ?? 0));
        if (cancelled) {
          void closeManagedView(viewId).catch(() => {});
          return;
        }
        viewIdRef.current = viewId;
        setState('live');
        void poll();
      } catch (error) {
        if (!cancelled) {
          console.info('[managed-browser] unavailable, using the native webview:', error);
          setState('unavailable');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      const opened = viewId ?? viewIdRef.current;
      viewIdRef.current = null;
      if (opened) void closeManagedView(opened).catch(() => {});
    };
  }, [isVisible, containerRef, ownerSessionId, ownerTabId]);

  // ── Forward panel input into the managed page ──
  useEffect(() => {
    if (state !== 'live' || !isVisible) return;
    const surface = canvasRef.current;
    if (!surface) return;

    const send = (method: string, params: Record<string, unknown>) => {
      const viewId = viewIdRef.current;
      if (!viewId) return;
      void sendManagedInput(viewId, method, params).catch(error => {
        console.warn('[managed-browser] input failed:', error);
      });
    };
    const point = (event: MouseEvent) => toPagePoint(
      event,
      surface.getBoundingClientRect(),
      frameSizeRef.current,
    );

    const onMouseDown = (event: MouseEvent) => {
      event.preventDefault();
      surface.focus();
      send('Input.dispatchMouseEvent', buildMouseEvent('mousePressed', point(event)));
    };
    const onMouseUp = (event: MouseEvent) => {
      send('Input.dispatchMouseEvent', buildMouseEvent('mouseReleased', point(event)));
    };
    const onMouseMove = (event: MouseEvent) => {
      send('Input.dispatchMouseEvent', buildMouseEvent('mouseMoved', point(event)));
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      send('Input.dispatchMouseEvent', buildMouseEvent('mouseWheel', point(event), {
        deltaX: event.deltaX,
        deltaY: event.deltaY,
      }));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const text = printableText(event);
      send('Input.dispatchKeyEvent', buildKeyEvent('keyDown', {
        key: event.key,
        code: event.code,
        windowsVirtualKeyCode: event.keyCode,
        modifiers: cdpModifiers(event),
      }, text));
    };
    const onKeyUp = (event: KeyboardEvent) => {
      send('Input.dispatchKeyEvent', buildKeyEvent('keyUp', {
        key: event.key,
        code: event.code,
        windowsVirtualKeyCode: event.keyCode,
        modifiers: cdpModifiers(event),
      }));
    };

    surface.addEventListener('mousedown', onMouseDown);
    surface.addEventListener('mouseup', onMouseUp);
    surface.addEventListener('mousemove', onMouseMove);
    surface.addEventListener('wheel', onWheel, { passive: false });
    surface.addEventListener('keydown', onKeyDown);
    surface.addEventListener('keyup', onKeyUp);
    return () => {
      surface.removeEventListener('mousedown', onMouseDown);
      surface.removeEventListener('mouseup', onMouseUp);
      surface.removeEventListener('mousemove', onMouseMove);
      surface.removeEventListener('wheel', onWheel);
      surface.removeEventListener('keydown', onKeyDown);
      surface.removeEventListener('keyup', onKeyUp);
    };
  }, [state, isVisible]);

  if (state === 'unavailable' || state === 'idle') return null;

  return (
    <canvas
      ref={canvasRef}
      tabIndex={0}
      aria-label="Managed browser view"
      className="h-full w-full outline-none"
      style={{ objectFit: 'contain' }}
    />
  );
}
