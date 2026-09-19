import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  buildKeyEvent,
  buildMouseEvent,
  cdpModifiers,
  closeManagedView,
  fetchManagedFrame,
  leaseViewToken,
  openManagedView,
  printableText,
  sendManagedInput,
} from './managedBrowserView';
import { apiFetch } from '@/api/apiFetch';
import { sessionSidecarFetch } from '@/api/tauriClient';
import { isTauriEnvironment } from '@/utils/browserMock';

vi.mock('@/api/apiFetch', () => ({
  apiFetch: vi.fn(),
}));
vi.mock('@/api/tauriClient', () => ({
  sessionSidecarFetch: vi.fn(),
}));
vi.mock('@/utils/browserMock', () => ({
  isTauriEnvironment: vi.fn(() => true),
}));

const mockedFetch = vi.mocked(apiFetch);
const mockedSession = vi.mocked(sessionSidecarFetch);
const mockedIsTauri = vi.mocked(isTauriEnvironment);

const OWNER = { sessionId: 'sess-1', tabId: 'tab-1' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('managed browser view client', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    mockedSession.mockReset();
    mockedIsTauri.mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it('leases a capability token from the session sidecar', async () => {
    mockedSession.mockResolvedValue(jsonResponse({ success: true, token: 'a'.repeat(32) }));
    await expect(leaseViewToken(OWNER)).resolves.toBe('a'.repeat(32));
    // The lease must not travel the global transport: only the owning Session
    // Sidecar's identity can be issued a capability for that session.
    expect(mockedFetch).not.toHaveBeenCalled();
    expect(mockedSession).toHaveBeenCalledWith(
      'sess-1',
      { type: 'tab', id: 'tab-1' },
      '/api/browser/view/token',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects a token response that carries no capability', async () => {
    mockedSession.mockResolvedValue(jsonResponse({ success: true }));
    await expect(leaseViewToken(OWNER)).rejects.toThrow('capability was not issued');
  });

  it('surfaces the server error text instead of a bare status', async () => {
    mockedSession.mockResolvedValue(jsonResponse({ success: false, error: 'BROWSER_RESOURCE_MISSING' }, 503));
    await expect(leaseViewToken(OWNER)).rejects.toThrow('BROWSER_RESOURCE_MISSING');
  });

  it('sends frame calls through the global sidecar that owns the Browser Host', async () => {
    mockedFetch.mockResolvedValue(jsonResponse({ success: true, viewId: 'view-7' }));
    await openManagedView('b'.repeat(32), 900, 600);
    expect(mockedSession).not.toHaveBeenCalled();
    expect(mockedFetch).toHaveBeenCalledWith('/api/browser/view/open', expect.objectContaining({ method: 'POST' }));
  });

  it('uses relative fetch when not running under Tauri', async () => {
    mockedIsTauri.mockReturnValue(false);
    mockedFetch.mockResolvedValue(jsonResponse({ success: true, token: 'c'.repeat(32) }));
    await expect(leaseViewToken(OWNER)).resolves.toBe('c'.repeat(32));
    expect(mockedSession).not.toHaveBeenCalled();
  });

  it('opens a view with the panel area and returns its id', async () => {
    mockedFetch.mockResolvedValue(jsonResponse({ success: true, viewId: 'view-7' }));
    await expect(openManagedView('b'.repeat(32), 900, 600)).resolves.toBe('view-7');
    const body = JSON.parse(String((mockedFetch.mock.calls[0][1] as RequestInit).body));
    expect(body).toEqual({ token: 'b'.repeat(32), width: 900, height: 600 });
  });

  it('pulls only frames newer than the caller already holds', async () => {
    mockedFetch.mockResolvedValue(jsonResponse({
      success: true,
      frame: { data: 'AA==', width: 100, height: 50, seq: 4 },
      latestSeq: 4,
    }));
    await expect(fetchManagedFrame('view-1', 3)).resolves.toEqual({
      frame: { data: 'AA==', width: 100, height: 50, seq: 4 },
      latestSeq: 4,
    });
    expect(mockedFetch).toHaveBeenCalledWith('/api/browser/view/frame?viewId=view-1&since=3');
  });

  it('reports no new frame without inventing one', async () => {
    mockedFetch.mockResolvedValue(jsonResponse({ success: true, frame: null, latestSeq: 9 }));
    await expect(fetchManagedFrame('view-1', 9)).resolves.toEqual({ frame: null, latestSeq: 9 });
  });

  it('closes a view idempotently through the panel route', async () => {
    mockedFetch.mockResolvedValue(jsonResponse({ success: true }));
    await expect(closeManagedView('view-1')).resolves.toBeUndefined();
  });

  it('forwards whitelisted input with the exact params', async () => {
    mockedFetch.mockResolvedValue(jsonResponse({ success: true }));
    await sendManagedInput('view-1', 'Input.insertText', { text: 'hi' });
    const body = JSON.parse(String((mockedFetch.mock.calls[0][1] as RequestInit).body));
    expect(body).toEqual({ viewId: 'view-1', method: 'Input.insertText', params: { text: 'hi' } });
  });
});

describe('managed browser input translation', () => {
  it('clamps and rounds mouse coordinates to the page grid', () => {
    expect(buildMouseEvent('mousePressed', { x: -5, y: 10.6 })).toMatchObject({
      type: 'mousePressed', x: 0, y: 11, button: 'left', clickCount: 1,
    });
    expect(buildMouseEvent('mouseMoved', { x: 3, y: 4 })).toMatchObject({ clickCount: 0 });
  });

  it('maps DOM modifiers onto the CDP bitmask', () => {
    expect(cdpModifiers({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: false })).toBe(0);
    expect(cdpModifiers({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false })).toBe(1);
    expect(cdpModifiers({ altKey: false, ctrlKey: true, metaKey: false, shiftKey: false })).toBe(2);
    expect(cdpModifiers({ altKey: false, ctrlKey: false, metaKey: true, shiftKey: false })).toBe(4);
    expect(cdpModifiers({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: true })).toBe(8);
    expect(cdpModifiers({ altKey: true, ctrlKey: true, metaKey: true, shiftKey: true })).toBe(15);
  });

  it('only treats an unmodified single character as printable text', () => {
    const base = { ctrlKey: false, metaKey: false, altKey: false };
    expect(printableText({ ...base, key: 'a' })).toBe('a');
    expect(printableText({ ...base, key: 'Enter' })).toBeUndefined();
    expect(printableText({ ...base, key: 'a', ctrlKey: true })).toBeUndefined();
    expect(printableText({ ...base, key: 'a', metaKey: true })).toBeUndefined();
  });

  it('sends key identity on keyUp so shortcuts release symmetrically', () => {
    const keyDown = buildKeyEvent('keyDown', { key: 'a', code: 'KeyA', modifiers: 0 }, 'a');
    const keyUp = buildKeyEvent('keyUp', { key: 'a', code: 'KeyA', modifiers: 0 });
    expect(keyDown).toMatchObject({ type: 'keyDown', key: 'a', code: 'KeyA', text: 'a' });
    expect(keyUp).toMatchObject({ type: 'keyUp', key: 'a', code: 'KeyA' });
    expect(keyUp).not.toHaveProperty('text');
  });

  it('carries the virtual key code for accelerators', () => {
    expect(buildKeyEvent('keyDown', {
      key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: 0,
    })).toMatchObject({ windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  });
});
