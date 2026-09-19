import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import ManagedBrowserCanvas, { fitFrameToBox, toPagePoint } from './ManagedBrowserCanvas';

vi.mock('@/api/apiFetch', () => ({
  apiFetch: vi.fn(async () => new Response(JSON.stringify({ success: false, error: 'no browser' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  })),
}));

describe('fitFrameToBox', () => {
  it('letterboxes a wide frame into a tall box without upscaling', () => {
    expect(fitFrameToBox({ width: 1600, height: 800 }, { width: 800, height: 1200 }))
      .toEqual({ width: 800, height: 400 });
  });

  it('letterboxes a tall frame into a wide box', () => {
    expect(fitFrameToBox({ width: 800, height: 1600 }, { width: 1200, height: 400 }))
      .toEqual({ width: 200, height: 400 });
  });

  it('never scales a frame up past its own resolution', () => {
    expect(fitFrameToBox({ width: 100, height: 100 }, { width: 1000, height: 1000 }))
      .toEqual({ width: 100, height: 100 });
  });

  it('degrades to a zero box instead of NaN for an unmeasured frame', () => {
    expect(fitFrameToBox({ width: 0, height: 0 }, { width: 800, height: 600 }))
      .toEqual({ width: 0, height: 0 });
    expect(fitFrameToBox({ width: 800, height: 600 }, { width: 0, height: 0 }))
      .toEqual({ width: 800, height: 600 });
  });
});

describe('toPagePoint', () => {
  const box = { left: 100, top: 50, width: 400, height: 300 };
  const frame = { width: 800, height: 600 };

  it('maps the container origin onto the page origin', () => {
    expect(toPagePoint({ clientX: 100, clientY: 50 }, box, frame)).toEqual({ x: 0, y: 0 });
  });

  it('scales a click by the frame-to-box ratio', () => {
    expect(toPagePoint({ clientX: 300, clientY: 200 }, box, frame)).toEqual({ x: 400, y: 300 });
  });

  it('clamps a pointer that leaves the panel to the page bounds', () => {
    expect(toPagePoint({ clientX: 9999, clientY: -9999 }, box, frame)).toEqual({ x: 800, y: 0 });
  });

  it('returns the origin rather than dividing by an unmeasured box', () => {
    expect(toPagePoint({ clientX: 10, clientY: 10 }, { left: 0, top: 0, width: 0, height: 0 }, frame))
      .toEqual({ x: 0, y: 0 });
  });
});

describe('ManagedBrowserCanvas', () => {
  afterEach(() => vi.restoreAllMocks());

  it('stays out of the way when the managed browser is unreachable', async () => {
    const container = document.createElement('div');
    const states: string[] = [];
    render(
      <ManagedBrowserCanvas
        containerRef={{ current: container }}
        owner={{ sessionId: 'sess-1', tabId: 'tab-1' }}
        isVisible
        onStateChange={state => states.push(state)}
      />,
    );
    // 'connecting' paints an empty canvas on purpose — the panel takes its
    // final geometry immediately instead of jumping when the first frame
    // lands. Only an unreachable botched lease removes it again.
    await waitFor(() => {
      expect(screen.queryByLabelText('Managed browser view')).toBeNull();
    });
    expect(states).toContain('unavailable');
  });

  it('renders nothing while idle', () => {
    render(
      <ManagedBrowserCanvas
        containerRef={{ current: null }}
        owner={{ sessionId: 'sess-1', tabId: 'tab-1' }}
        isVisible={false}
        onStateChange={() => {}}
      />,
    );
    expect(screen.queryByLabelText('Managed browser view')).toBeNull();
  });
});
