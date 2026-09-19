import { apiFetch } from '@/api/apiFetch';
import { sessionSidecarFetch } from '@/api/tauriClient';
import { isTauriEnvironment } from '@/utils/browserMock';

/**
 * Renderer client for the managed Browser view.
 *
 * The split-panel browser used to render a wry/WKWebView child that only the
 * *user* could drive, while the Agent drove a different Chromium — two
 * browsers, two logins, two copies of the page. These calls turn the panel
 * into a view of the one Chromium the Agent already drives:
 *
 *   POST /api/browser/view/token  → lease this session's capability (Session Sidecar)
 *   POST /api/browser/view/open   → start a screencast on the managed page (Global Sidecar)
 *   GET  /api/browser/view/frame  → pull the newest frame (no push stream exists)
 *   POST /api/browser/view/input  → send panel input back into the page
 *   POST /api/browser/view/close  → detach the view, leaving the Agent's page alive
 */

export interface ManagedFrame {
  /** base64 JPEG. */
  data: string;
  width: number;
  height: number;
  seq: number;
}

export interface ManagedFrameResponse {
  frame: ManagedFrame | null;
  latestSeq: number;
}

/**
 * Frames are pulled on a timer rather than streamed.
 *
 * Rust's SSE proxy is hard-wired to `/chat/stream` and the Browser capability
 * token stays inside the Session Sidecar, so the renderer cannot subscribe to
 * the Global Sidecar. Polling is also the semantically correct backpressure
 * here: an intermediate frame is worthless, so only the newest is rendered.
 * 100 ms keeps interaction feeling immediate without a per-frame round trip
 * that would inflate IPC traffic.
 */
export const MANAGED_FRAME_POLL_MS = 100;

/**
 * Which Sidecar answers each call is a correctness detail, not a preference.
 *
 * Only the Session Sidecar that owns a session can be issued a Browser
 * capability for it (Rust validates its `MYAGENTS_SIDECAR_ID` against the live
 * instance), and only the Global Sidecar may *verify* one — it is the role that
 * runs the Browser Host. So the lease must travel the session transport and
 * every later call the global one; swapping them yields "requires a Sidecar
 * process identity" or "Only the current Global Sidecar may verify".
 *
 * The capability token is created here and never handed to Rust, so the
 * panel cannot address the Browser Host except through these routes.
 */
export type ViewOwner = { sessionId: string; tabId: string };

function sidecarTransport(endpoint: string, owner: ViewOwner, options: RequestInit): Promise<Response> {
  // Browser dev mode has one union server and no Tauri IPC to proxy through.
  if (!isTauriEnvironment()) return apiFetch(endpoint, options);
  return sessionSidecarFetch(owner.sessionId, { type: 'tab', id: owner.tabId }, endpoint, options);
}

async function readJson<T>(response: Response, fallbackError: string): Promise<T> {
  const payload = await response.json().catch(() => null) as
    | ({ success?: boolean; error?: string } & Record<string, unknown>)
    | null;
  if (!response.ok || payload?.success !== true) {
    throw new Error(payload?.error ?? `${fallbackError} (HTTP ${response.status})`);
  }
  return payload as T;
}

function postJson<T>(endpoint: string, body: unknown, owner?: ViewOwner): Promise<T> {
  const options: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
  return (owner ? sidecarTransport(endpoint, owner, options) : apiFetch(endpoint, options))
    .then(response => readJson<T>(response, endpoint));
}

/**
 * Lease the managed-Browser capability bound to this product session.
 * Must go through the session's own Sidecar — see `ViewOwner` above.
 */
export async function leaseViewToken(owner: ViewOwner): Promise<string> {
  const result = await postJson<{ token?: string }>('/api/browser/view/token', {}, owner);
  if (!result.token) throw new Error('Browser view capability was not issued');
  return result.token;
}

export async function openManagedView(
  token: string,
  width: number,
  height: number,
): Promise<string> {
  const result = await postJson<{ viewId?: string }>('/api/browser/view/open', {
    token, width, height,
  });
  if (!result.viewId) throw new Error('Browser view was not opened');
  return result.viewId;
}

export async function fetchManagedFrame(
  viewId: string,
  sinceSeq: number,
): Promise<ManagedFrameResponse> {
  const response = await apiFetch(
    `/api/browser/view/frame?viewId=${encodeURIComponent(viewId)}&since=${sinceSeq}`,
  );
  const payload = await response.json().catch(() => null) as
    | { success?: boolean; frame?: ManagedFrame | null; latestSeq?: number }
    | null;
  if (!response.ok || payload?.success !== true) throw new Error(`HTTP ${response.status}`);
  return { frame: payload.frame ?? null, latestSeq: payload.latestSeq ?? 0 };
}

export async function sendManagedInput(
  viewId: string,
  method: string,
  params: Record<string, unknown>,
): Promise<void> {
  await postJson('/api/browser/view/input', { viewId, method, params });
}

export async function closeManagedView(viewId: string): Promise<void> {
  await postJson('/api/browser/view/close', { viewId });
}

/** CSS pixels → CDP mouse event, the translation the panel's input needs. */
export function buildMouseEvent(
  type: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel',
  point: { x: number; y: number },
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type,
    x: Math.max(0, Math.round(point.x)),
    y: Math.max(0, Math.round(point.y)),
    button: 'left',
    clickCount: type === 'mouseMoved' ? 0 : 1,
    ...extra,
  };
}

/**
 * Map a DOM keyboard event onto CDP's key fields.
 *
 * `key`/`code`/`text` are all needed: Chromium decides what to insert from
 * `text` for printable keys and from `code` for accelerators, so dropping
 * either makes typing look correct in a text field but break shortcuts.
 */
export function buildKeyEvent(
  type: 'keyDown' | 'keyUp' | 'char',
  event: {
    key: string;
    code: string;
    windowsVirtualKeyCode?: number;
    modifiers: number;
  },
  text?: string,
): Record<string, unknown> {
  return {
    type,
    key: event.key,
    code: event.code,
    windowsVirtualKeyCode: event.windowsVirtualKeyCode ?? 0,
    nativeVirtualKeyCode: event.windowsVirtualKeyCode ?? 0,
    modifiers: event.modifiers,
    ...(type === 'char' && text ? { text } : {}),
    ...(type === 'keyDown' && text ? { text } : {}),
  };
}

/** CDP modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8. */
export function cdpModifiers(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): number {
  return (event.altKey ? 1 : 0)
    | (event.ctrlKey ? 2 : 0)
    | (event.metaKey ? 4 : 0)
    | (event.shiftKey ? 8 : 0);
}

/** A printable key produces text; modifiers and named keys never do. */
export function printableText(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): string | undefined {
  if (event.ctrlKey || event.metaKey || event.altKey) return undefined;
  return event.key.length === 1 ? event.key : undefined;
}
