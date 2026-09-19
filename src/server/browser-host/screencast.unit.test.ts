import { describe, expect, it, vi } from 'vitest';

import {
  BrowserViewManager,
  MAX_VIEW_SESSIONS,
  SCREENCAST_MAX_HEIGHT,
  SCREENCAST_MAX_WIDTH,
  buildViewportMetrics,
  capabilityToken,
  type ScreencastFrame,
} from './screencast';
import type { BrowserContextRegistry } from './context-registry';
import type { VerifiedBrowserCapability } from './capability-client';

const TOKEN = 'c'.repeat(32);
const SESSION_ID = 'session-a';

interface FakeCdp {
  send: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
  emit(event: string, payload: unknown): void;
  sent: Array<{ method: string; params: Record<string, unknown> | undefined }>;
}

function fakeCdp(): FakeCdp {
  const listeners = new Map<string, Array<(payload: unknown) => void>>();
  const sent: Array<{ method: string; params: Record<string, unknown> | undefined }> = [];
  return {
    send: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      sent.push({ method, params });
      return {};
    }),
    on: vi.fn((event: string, listener: (payload: unknown) => void) => {
      const bucket = listeners.get(event) ?? [];
      bucket.push(listener);
      listeners.set(event, bucket);
    }),
    detach: vi.fn(async () => {}),
    emit: (event, payload) => {
      for (const listener of listeners.get(event) ?? []) listener(payload);
    },
    sent,
  };
}

function framePayload(sessionId = 1): unknown {
  return {
    data: 'ZnJhbWU=',
    sessionId,
    metadata: { deviceWidth: 1024, deviceHeight: 768 },
  };
}

function fakeRegistry(pageCount = 1) {
  const cdp = fakeCdp();
  const page = { id: 'page-1' };
  const context = {
    pages: vi.fn(() => Array.from({ length: pageCount }, (_, index) => ({ id: `page-${index + 1}` }))),
    newPage: vi.fn(async () => page),
    newCDPSession: vi.fn(async () => cdp),
  };
  return {
    cdp,
    page,
    context,
    registry: {
      getContext: vi.fn(async () => context),
    } as unknown as BrowserContextRegistry,
  };
}

function capability(productSessionId = SESSION_ID): VerifiedBrowserCapability {
  return { productSessionId, workspacePath: '/workspace/a', hostGeneration: 3 };
}

describe('buildViewportMetrics', () => {
  it('passes through a panel-sized area at scale factor 1', () => {
    expect(buildViewportMetrics(900, 600)).toEqual({
      width: 900,
      height: 600,
      deviceScaleFactor: 1,
      mobile: false,
    });
  });

  it('clamps to the screencast budget and floors fractional css pixels', () => {
    expect(buildViewportMetrics(9000, 9000)).toEqual({
      width: SCREENCAST_MAX_WIDTH,
      height: SCREENCAST_MAX_HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
    });
    expect(buildViewportMetrics(800.7, 600.2)).toMatchObject({ width: 800, height: 600 });
  });

  it('never emits a zero-size viewport that would collapse the page', () => {
    expect(buildViewportMetrics(0, 0)).toMatchObject({ width: 1, height: 1 });
    expect(buildViewportMetrics(Number.NaN, -40)).toMatchObject({ width: 1, height: 1 });
  });
});

describe('capabilityToken', () => {
  function withAuth(value: string | null): Request {
    return new Request('http://127.0.0.1:1/mcp/browser-view', {
      headers: value === null ? {} : { Authorization: value },
    });
  }

  it('accepts the 32-hex product capability and rejects anything else', () => {
    expect(capabilityToken(withAuth(`Bearer ${TOKEN}`))).toBe(TOKEN);
    expect(capabilityToken(withAuth('Bearer short'))).toBeNull();
    expect(capabilityToken(withAuth('Bearer ' + 'Z'.repeat(32)))).toBeNull();
    expect(capabilityToken(withAuth(null))).toBeNull();
    expect(capabilityToken(withAuth(TOKEN))).toBeNull();
  });
});

describe('BrowserViewManager', () => {
  function manager(registryData = fakeRegistry()) {
    const verifyCapability = vi.fn(async () => capability());
    return {
      ...registryData,
      verifyCapability,
      manager: new BrowserViewManager({
        registry: registryData.registry,
        verifyCapability,
      }),
    };
  }

  it('starts a screencast on the managed page and acks every frame', async () => {
    const { manager: views, cdp } = manager();
    const frames: ScreencastFrame[] = [];

    const session = await views.openView(TOKEN, 1024, 768, frame => frames.push(frame));

    expect(cdp.sent.map(entry => entry.method)).toEqual([
      'Page.enable',
      'Emulation.setDeviceMetricsOverride',
      'Page.startScreencast',
    ]);
    expect(cdp.sent[2].params).toMatchObject({ format: 'jpeg', maxWidth: SCREENCAST_MAX_WIDTH });

    cdp.emit('Page.screencastFrame', framePayload(41));
    expect(frames).toEqual([{ data: 'ZnJhbWU=', width: 1024, height: 768, seq: 1 }]);
    // Without the ack Chromium stops after the first frame.
    expect(cdp.send).toHaveBeenCalledWith('Page.screencastFrameAck', { sessionId: 41 });

    session.close();
  });

  it('falls back to the requested viewport when frame metadata omits dimensions', async () => {
    const { manager: views, cdp } = manager();
    const frames: ScreencastFrame[] = [];
    await views.openView(TOKEN, 640, 480, frame => frames.push(frame));

    cdp.emit('Page.screencastFrame', { data: 'eA==', sessionId: 2 });

    expect(frames).toEqual([{ data: 'eA==', width: 640, height: 480, seq: 1 }]);
  });

  it('creates the first page when the managed context is still empty', async () => {
    const data = fakeRegistry(0);
    const { manager: views, context } = manager(data);
    const session = await views.openView(TOKEN, 800, 600, () => {});
    expect(context.newPage).toHaveBeenCalledTimes(1);
    session.close();
  });

  it('reuses the newest existing page instead of opening another', async () => {
    const data = fakeRegistry(3);
    const { manager: views, context } = manager(data);
    const session = await views.openView(TOKEN, 800, 600, () => {});
    expect(context.newPage).not.toHaveBeenCalled();
    expect(context.newCDPSession).toHaveBeenCalledWith({ id: 'page-3' });
    session.close();
  });

  it('detaches without closing the browser so the Agent keeps the same Context', async () => {
    const { manager: views, cdp, context } = manager();
    const session = await views.openView(TOKEN, 800, 600, () => {});

    session.close();

    expect(cdp.send).toHaveBeenCalledWith('Page.stopScreencast');
    expect(cdp.detach).toHaveBeenCalledTimes(1);
    expect(context.newCDPSession).toHaveBeenCalledTimes(1);
  });

  it('replaces a previous view for the same product session', async () => {
    const data = fakeRegistry();
    // Each openView needs its own CDP session to observe independent detaches.
    const cdps: FakeCdp[] = [];
    (data.context.newCDPSession as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      const cdp = fakeCdp();
      cdps.push(cdp);
      return cdp;
    });
    const { manager: views } = manager(data);

    const first = await views.openView(TOKEN, 800, 600, () => {});
    const second = await views.openView(TOKEN, 800, 600, () => {});

    expect(cdps[0].detach).toHaveBeenCalledTimes(1);
    expect(cdps[1].detach).not.toHaveBeenCalled();
    await expect(views.dispatchInput(first.id, 'Input.insertText', { text: 'x' }))
      .rejects.toThrow('BROWSER_VIEW_NOT_FOUND');
    second.close();
  });

  it('stops delivering frames once a view is closed', async () => {
    const { manager: views, cdp } = manager();
    const frames: ScreencastFrame[] = [];
    const session = await views.openView(TOKEN, 800, 600, frame => frames.push(frame));

    session.close();
    cdp.emit('Page.screencastFrame', framePayload(9));

    expect(frames).toEqual([]);
  });

  it('forwards only whitelisted input methods to the page', async () => {
    const { manager: views, cdp } = manager();
    const session = await views.openView(TOKEN, 800, 600, () => {});

    await views.dispatchInput(session.id, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: 1, y: 2 });
    expect(cdp.send).toHaveBeenCalledWith('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1, y: 2 });

    await expect(views.dispatchInput(session.id, 'Runtime.evaluate', { expression: '1' }))
      .rejects.toThrow('BROWSER_VIEW_INPUT_UNSUPPORTED');
    await expect(views.dispatchInput(session.id, 'Page.captureScreenshot', {}))
      .rejects.toThrow('BROWSER_VIEW_INPUT_UNSUPPORTED');
  });

  it('resizes through the same CDP session that owns the page', async () => {
    const { manager: views, cdp } = manager();
    const session = await views.openView(TOKEN, 800, 600, () => {});

    await views.resizeView(session.id, 1200, 700);

    expect(cdp.send).toHaveBeenLastCalledWith('Emulation.setDeviceMetricsOverride', {
      width: 1200,
      height: 700,
      deviceScaleFactor: 1,
      mobile: false,
    });
  });

  it('serves the newest frame once and then reports nothing new for that seq', async () => {
    const { manager: views, cdp } = manager();
    const session = await views.openView(TOKEN, 800, 600, () => {});

    expect(views.latestFrame(session.id, 0)).toEqual({ frame: null, latestSeq: 0 });

    cdp.emit('Page.screencastFrame', framePayload(1));
    cdp.emit('Page.screencastFrame', framePayload(2));
    cdp.emit('Page.screencastFrame', framePayload(3));

    // Superseded frames are dropped: the panel only ever needs the newest.
    const pulled = views.latestFrame(session.id, 0);
    expect(pulled.latestSeq).toBe(3);
    expect(pulled.frame).toMatchObject({ seq: 3 });

    expect(views.latestFrame(session.id, 3)).toEqual({ frame: null, latestSeq: 3 });

    cdp.emit('Page.screencastFrame', framePayload(4));
    expect(views.latestFrame(session.id, 3).frame).toMatchObject({ seq: 4 });
  });

  it('refuses to serve frames for an unknown or closed view', async () => {
    const { manager: views } = manager();
    const session = await views.openView(TOKEN, 800, 600, () => {});

    expect(() => views.latestFrame('view-missing', 0)).toThrow('BROWSER_VIEW_NOT_FOUND');

    session.close();
    expect(() => views.latestFrame(session.id, 0)).toThrow('BROWSER_VIEW_NOT_FOUND');
  });

  it('rejects a view whose capability cannot be verified', async () => {
    const data = fakeRegistry();
    const verifyCapability = vi.fn(async () => {
      const error = new Error('nope');
      error.name = 'browser_capability_invalid';
      throw error;
    });
    const views = new BrowserViewManager({ registry: data.registry, verifyCapability });

    await expect(views.openView('bad', 800, 600, () => {})).rejects.toThrow('nope');
    expect(data.context.newCDPSession).not.toHaveBeenCalled();
  });

  it('closes views for a retired session and on shutdown', async () => {
    const data = fakeRegistry();
    const cdps: FakeCdp[] = [];
    (data.context.newCDPSession as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      const cdp = fakeCdp();
      cdps.push(cdp);
      return cdp;
    });
    const { manager: views } = manager(data);

    await views.openView(TOKEN, 800, 600, () => {});
    views.closeViewsForSession(SESSION_ID);
    expect(cdps[0].detach).toHaveBeenCalledTimes(1);

    await views.openView(TOKEN, 800, 600, () => {});
    views.shutdown();
    expect(cdps[1].detach).toHaveBeenCalledTimes(1);
  });

  it('evicts the oldest view beyond the concurrent-view budget', async () => {
    const data = fakeRegistry();
    const cdps: FakeCdp[] = [];
    let index = 0;
    (data.context.newCDPSession as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      const cdp = fakeCdp();
      cdps.push(cdp);
      return cdp;
    });
    const verifyCapability = vi.fn(async () => capability(`session-${index += 1}`));
    const views = new BrowserViewManager({ registry: data.registry, verifyCapability });

    for (let opened = 0; opened < MAX_VIEW_SESSIONS + 2; opened += 1) {
      await views.openView(TOKEN, 800, 600, () => {});
    }

    expect(cdps[0].detach).toHaveBeenCalledTimes(1);
    expect(cdps[1].detach).toHaveBeenCalledTimes(1);
    const stillOpen = cdps.filter(cdp => cdp.detach.mock.calls.length === 0);
    expect(stillOpen).toHaveLength(MAX_VIEW_SESSIONS);
  });
});
