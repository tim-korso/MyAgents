import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useTauriFileDrop } from './useTauriFileDrop';

interface TestDragEvent {
  payload: {
    position?: { x: number; y: number };
    paths?: string[];
  };
}

const listenerState = vi.hoisted(() => ({
  listeners: new Map<string, Set<(event: TestDragEvent) => void>>(),
}));

vi.mock('@/utils/tauriListen', () => ({
  listenWithCleanup: vi.fn((eventName: string, listener: (event: TestDragEvent) => void, signal: AbortSignal) => {
    const listeners = listenerState.listeners.get(eventName) ?? new Set();
    listeners.add(listener); listenerState.listeners.set(eventName, listeners);
    signal.addEventListener('abort', () => listeners.delete(listener), { once: true });
    return Promise.resolve();
  }),
}));

vi.mock('@/utils/browserMock', () => ({
  isTauriEnvironment: () => true,
}));

vi.mock('@/utils/debug', () => ({
  isDebugMode: () => false,
}));

vi.mock('@/analytics', () => ({
  track: vi.fn(),
}));

function emit(eventName: string, payload: TestDragEvent['payload']) {
  const listener = listenerState.listeners.get(eventName);
  expect(listener).toBeDefined();
  act(() => listener?.forEach(callback => callback({ payload })));
}

afterEach(() => {
  listenerState.listeners.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useTauriFileDrop', () => {
  it('uses current-DPR CSS coordinates for zone hit-testing and drop callbacks', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const zoneDrop = vi.fn();
    const onDrop = vi.fn();
    const zone = document.createElement('div');
    vi.spyOn(zone, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      right: 200,
      top: 50,
      bottom: 100,
      width: 100,
      height: 50,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    });
    const { result } = renderHook(() => useTauriFileDrop({ onDrop }));

    act(() => result.current.registerZone('input', zone, zoneDrop));
    emit('tauri://drag-enter', { position: { x: 300, y: 150 } });
    expect(result.current.activeZoneId).toBe('input');

    // The hook must not cache DPR: the window may move to another display
    // between drag events.
    vi.stubGlobal('devicePixelRatio', 1.5);
    emit('tauri://drag-drop', {
      position: { x: 225, y: 112.5 },
      paths: ['/tmp/report.pdf'],
    });

    expect(zoneDrop).toHaveBeenCalledWith(['/tmp/report.pdf'], { x: 150, y: 75 });
    expect(onDrop).toHaveBeenCalledWith(
      ['/tmp/report.pdf'],
      'input',
      { x: 150, y: 75 },
    );

    emit('tauri://drag-drop', {
      position: { x: 450, y: 112.5 },
      paths: ['/tmp/outside.pdf'],
    });
    expect(zoneDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenLastCalledWith(
      ['/tmp/outside.pdf'],
      null,
      { x: 300, y: 75 },
    );
  });

  it('clears drag state when a mounted surface is disabled and re-enabled', () => {
    vi.stubGlobal('devicePixelRatio', 1);
    const zone = document.createElement('div');
    vi.spyOn(zone, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 100,
      top: 0,
      bottom: 100,
      width: 100,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const { result, rerender } = renderHook(
      ({ enabled }) => useTauriFileDrop({ enabled }),
      { initialProps: { enabled: true } },
    );

    act(() => result.current.registerZone('input', zone, vi.fn()));
    emit('tauri://drag-enter', { position: { x: 50, y: 50 } });
    expect(result.current).toMatchObject({ isDragging: true, activeZoneId: 'input' });

    rerender({ enabled: false });
    expect(result.current).toMatchObject({ isDragging: false, activeZoneId: null });

    rerender({ enabled: true });
    expect(result.current).toMatchObject({ isDragging: false, activeZoneId: null });

    emit('tauri://drag-over', { position: { x: 50, y: 50 } });
    expect(result.current).toMatchObject({ isDragging: true, activeZoneId: 'input' });
  });
  it('gives a nested visible editor sole ownership and blocks overlays or paused editors', () => {
    vi.stubGlobal('devicePixelRatio', 1);
    const chat = document.createElement('div'), editor = document.createElement('div'), target = document.createElement('span');
    chat.append(editor); editor.append(target); document.body.append(chat);
    for (const zone of [chat, editor]) vi.spyOn(zone, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100));
    const hit = vi.fn(() => target as Element | null);
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: hit });
    const chatDrop = vi.fn(), editorDrop = vi.fn();
    const outer = renderHook(() => useTauriFileDrop()), inner = renderHook(() => useTauriFileDrop());
    act(() => { outer.result.current.registerZone('chat', chat, chatDrop); inner.result.current.registerZone('markdown', editor, editorDrop); });
    emit('tauri://drag-drop', { paths: ['/tmp/picture.png'], position: { x: 20, y: 20 } });
    expect(editorDrop).toHaveBeenCalledTimes(1); expect(chatDrop).not.toHaveBeenCalled();
    editor.setAttribute('inert', '');
    emit('tauri://drag-drop', { paths: ['/tmp/picture.png'], position: { x: 20, y: 20 } });
    editor.removeAttribute('inert');
    hit.mockReturnValue(document.createElement('div')); // Floating comparison covers both.
    emit('tauri://drag-drop', { paths: ['/tmp/picture.png'], position: { x: 20, y: 20 } });
    hit.mockReturnValue(null); // Outside the hit-testable document.
    emit('tauri://drag-drop', { paths: ['/tmp/picture.png'], position: { x: 20, y: 20 } });
    expect(editorDrop).toHaveBeenCalledTimes(1); expect(chatDrop).not.toHaveBeenCalled();
    inner.unmount(); outer.unmount(); chat.remove();
    expect([...listenerState.listeners.values()].every(listeners => listeners.size === 0)).toBe(true);
    Reflect.deleteProperty(document, 'elementFromPoint');
  });

});
