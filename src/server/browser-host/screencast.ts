import type { BrowserContext, Page } from 'playwright';

import type { BrowserContextRegistry } from './context-registry';
import type { VerifiedBrowserCapability } from './capability-client';

/**
 * The panel and the Agent drive one Chromium Context.
 *
 * MyAgents renders its split-panel browser in a wry/WKWebView child, which has
 * no CDP surface, so Playwright can never drive what the user actually sees.
 * Meanwhile the managed browser the Agent drives lives in a separate Chromium
 * whose only inspector is the CDP session Playwright already owns. This module
 * closes that gap the way Steel/browser-use do: the managed Chromium stays the
 * single browser, and the panel becomes a *view* of it — CDP screencast frames
 * out, panel input events back in.
 */

/** Matches the panel's own budget: one frame per interactive step, not a video stream. */
export const SCREENCAST_MAX_WIDTH = 1280;
export const SCREENCAST_MAX_HEIGHT = 900;
export const SCREENCAST_QUALITY = 70;
export const VIEW_SESSION_IDLE_TIMEOUT_MS = 60_000;
export const MAX_VIEW_SESSIONS = 8;

export interface ScreencastFrame {
  /** base64-encoded JPEG. */
  data: string;
  /** Device-pixel size of the frame Chromium produced. */
  width: number;
  height: number;
  /** Monotonic per View; lets the panel skip a redraw it already has. */
  seq: number;
}

export interface FrameSnapshot {
  frame: ScreencastFrame | null;
  /** Sequence the caller already holds; only a larger one is worth fetching. */
  latestSeq: number;
}

export interface ViewSession {
  readonly id: string;
  readonly productSessionId: string;
  close(): void;
}

export interface ScreencastDependencies {
  registry: BrowserContextRegistry;
  verifyCapability(token: string, signal?: AbortSignal): Promise<VerifiedBrowserCapability>;
}

/**
 * Structural view of Playwright's CDPSession.
 *
 * Declared here instead of importing `CDPSession` so this module does not
 * couple to Playwright's generated `Protocol.CommandParameters` map: a
 * pinned alpha's protocol types can lag the Chromium build it ships, and a
 * missing entry would make `send('Page.startScreencast', …)` a compile error
 * for a method Chromium definitely implements.
 */
interface CdpConnection {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, listener: (payload: ScreencastFramePayload) => void): unknown;
  detach(): Promise<void>;
}

interface ScreencastFramePayload {
  data: string;
  sessionId: number;
  metadata?: {
    deviceWidth?: number;
    deviceHeight?: number;
  };
}

interface ViewEntry {
  id: string;
  productSessionId: string;
  cdp: CdpConnection;
  page: Page;
  idleTimer: ReturnType<typeof setTimeout> | null;
  latestFrame: ScreencastFrame | null;
  frameSeq: number;
  closed: boolean;
}

/**
 * Chromium's screencast emits `Page.screencastFrame` with the frame plus a
 * session id that must be acked, otherwise capture stops after the first
 * frame. The device metrics must match the panel's area or Chromium letterboxes
 * the page into a fixed viewport.
 */
export function buildViewportMetrics(width: number, height: number): Record<string, unknown> {
  // `Math.min(Math.max(NaN, 1), floor)` stays NaN, and a NaN override makes
  // Chromium reject the metrics call, so non-finite input must be caught here
  // rather than by the clamps.
  const clamp = (value: number, maximum: number): number => {
    if (!Number.isFinite(value)) return 1;
    return Math.min(Math.max(Math.floor(value), 1), maximum);
  };
  const safeWidth = clamp(width, SCREENCAST_MAX_WIDTH);
  const safeHeight = clamp(height, SCREENCAST_MAX_HEIGHT);
  return {
    width: safeWidth,
    height: safeHeight,
    deviceScaleFactor: 1,
    mobile: false,
  };
}

function capabilityToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return /^[a-f0-9]{32}$/.test(token) ? token : null;
}

export { capabilityToken };

export class BrowserViewManager {
  private readonly dependencies: ScreencastDependencies;
  private readonly views = new Map<string, ViewEntry>();
  private readonly viewsBySession = new Map<string, string>();
  /**
   * Monotonic. Deriving the id from `views.size` collides as soon as eviction
   * brings the size back down: the next id repeats a live one and
   * `Map.set` silently overwrites that entry, leaking its CDP session.
   */
  private nextViewSequence = 0;

  constructor(dependencies: ScreencastDependencies) {
    this.dependencies = dependencies;
  }

  async openView(
    token: string,
    viewportWidth: number,
    viewportHeight: number,
    onFrame: (frame: ScreencastFrame) => void,
  ): Promise<ViewSession> {
    const binding = await this.dependencies.verifyCapability(token);
    const context = await this.dependencies.registry.getContext(binding);
    const page = await this.resolvePage(context, binding);
    const cdp = await context.newCDPSession(page) as unknown as CdpConnection;

    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', buildViewportMetrics(viewportWidth, viewportHeight));

    this.nextViewSequence += 1;
    const id = `view-${this.nextViewSequence}`;
    const entry: ViewEntry = {
      id,
      productSessionId: binding.productSessionId,
      cdp,
      page,
      idleTimer: null,
      latestFrame: null,
      frameSeq: 0,
      closed: false,
    };

    cdp.on('Page.screencastFrame', (payload) => {
      if (entry.closed) return;
      entry.frameSeq += 1;
      const frame: ScreencastFrame = {
        data: String(payload.data),
        width: Number(payload.metadata?.deviceWidth ?? viewportWidth),
        height: Number(payload.metadata?.deviceHeight ?? viewportHeight),
        seq: entry.frameSeq,
      };
      entry.latestFrame = frame;
      // Ack first: a throwing frame consumer must not strand CDP capture.
      void cdp.send('Page.screencastFrameAck', { sessionId: payload.sessionId }).catch(() => {});
      try {
        onFrame(frame);
      } catch {
        // A dead transport is the View's problem; capture stays owned here.
      }
      this.touch(entry);
    });

    // The previous View for this Session must stop before a second one starts,
    // or two CDP sessions would fight over the same page.
    const previousId = this.viewsBySession.get(binding.productSessionId);
    if (previousId) this.closeView(previousId, 'replaced');

    this.views.set(id, entry);
    this.viewsBySession.set(binding.productSessionId, id);
    this.evictOverflow();

    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: SCREENCAST_QUALITY,
      maxWidth: SCREENCAST_MAX_WIDTH,
      maxHeight: SCREENCAST_MAX_HEIGHT,
      everyNthFrame: 1,
    });
    this.touch(entry);

    return {
      id,
      productSessionId: binding.productSessionId,
      close: () => this.closeView(id, 'closed'),
    };
  }

  /** Panel input comes back through the same CDP session that owns the page. */
  async dispatchInput(viewId: string, method: string, params: Record<string, unknown>): Promise<void> {
    const entry = this.views.get(viewId);
    if (!entry || entry.closed) throw new Error('BROWSER_VIEW_NOT_FOUND');
    if (!INPUT_METHODS.has(method)) throw new Error('BROWSER_VIEW_INPUT_UNSUPPORTED');
    await entry.cdp.send(method, params);
    this.touch(entry);
  }

  /**
   * Pull the newest frame for a View.
   *
   * The panel is pull-based instead of served by a push stream: Rust's SSE
   * proxy is hard-wired to `/chat/stream`, and the Browser capability token
   * never leaves the Session Sidecar, so the renderer cannot subscribe to the
   * Global Sidecar directly. A frame stream would also be the wrong shape —
   * a mid-render frame is worthless, so dropping all but the latest is the
   * correct backpressure, not a compromise.
   */
  latestFrame(viewId: string, sinceSeq: number): FrameSnapshot {
    const entry = this.views.get(viewId);
    if (!entry || entry.closed) throw new Error('BROWSER_VIEW_NOT_FOUND');
    this.touch(entry);
    if (!entry.latestFrame || entry.latestFrame.seq <= sinceSeq) {
      return { frame: null, latestSeq: entry.frameSeq };
    }
    return { frame: entry.latestFrame, latestSeq: entry.frameSeq };
  }

  async resizeView(viewId: string, width: number, height: number): Promise<void> {
    const entry = this.views.get(viewId);
    if (!entry || entry.closed) throw new Error('BROWSER_VIEW_NOT_FOUND');
    await entry.cdp.send('Emulation.setDeviceMetricsOverride', buildViewportMetrics(width, height));
    this.touch(entry);
  }

  closeView(viewId: string, reason: string): void {
    const entry = this.views.get(viewId);
    if (!entry || entry.closed) return;
    entry.closed = true;
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
    this.views.delete(viewId);
    if (this.viewsBySession.get(entry.productSessionId) === viewId) {
      this.viewsBySession.delete(entry.productSessionId);
    }
    // Detach without closing the page: the Agent keeps driving the same
    // Context, and only the View (not the browser) is going away.
    void entry.cdp.send('Page.stopScreencast').catch(() => {});
    void entry.cdp.detach().catch(() => {});
    console.info(`[browser-view] close id=${viewId} reason=${reason}`);
  }

  closeViewsForSession(productSessionId: string): void {
    const viewId = this.viewsBySession.get(productSessionId);
    if (viewId) this.closeView(viewId, 'session-retired');
  }

  shutdown(): void {
    for (const viewId of [...this.views.keys()]) this.closeView(viewId, 'shutdown');
  }

  private touch(entry: ViewEntry): void {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      this.closeView(entry.id, 'idle');
    }, VIEW_SESSION_IDLE_TIMEOUT_MS);
    entry.idleTimer.unref?.();
  }

  private evictOverflow(): void {
    while (this.views.size > MAX_VIEW_SESSIONS) {
      const oldest = this.views.keys().next().value;
      if (oldest === undefined) return;
      this.closeView(oldest, 'overflow');
    }
  }

  private async resolvePage(context: BrowserContext, binding: VerifiedBrowserCapability): Promise<Page> {
    const existing = context.pages();
    if (existing.length > 0) return existing[existing.length - 1];
    const page = await context.newPage();
    console.info(`[browser-view] created-first-page session=${binding.productSessionId}`);
    return page;
  }
}

/** Panel input methods forwarded to CDP; the set is explicit so a caller cannot proxy arbitrary protocol. */
const INPUT_METHODS = new Set([
  'Input.dispatchMouseEvent',
  'Input.dispatchKeyEvent',
  'Input.insertText',
  'Page.navigate',
  'Page.reload',
  'Page.goBack',
  'Page.goForward',
]);
