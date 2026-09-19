import { describe, expect, it } from 'vitest';

import { buildFunctionalHealth, buildReadyHealth } from './gateway-health';

const baseInput = {
  pluginLoaded: true,
  gatewayError: null,
  gatewayStarted: true,
  waitingForQrLogin: false,
  hasGateway: true,
  nowMs: 1_000_000,
  stalenessMs: 90_000,
};

describe('plugin bridge gateway health', () => {
  it('reports ready when the plugin loaded and gateway was started', () => {
    expect(buildReadyHealth(baseInput)).toMatchObject({
      status: 200,
      body: { state: 'ready' },
    });
  });

  it('maps fresh openclaw-weixin lastEventAt to poll heartbeat', () => {
    expect(buildFunctionalHealth({
      ...baseInput,
      pluginId: 'openclaw-weixin',
      gatewayStatus: { running: true, lastEventAt: 950_000 },
    })).toMatchObject({
      status: 200,
      body: {
        state: 'functional',
        reason: 'gateway-poll',
        heartbeatSource: 'lastEventAt:openclaw-weixin',
      },
    });
  });

  it('reports stale openclaw-weixin lastEventAt heartbeat as unfunctional', () => {
    expect(buildFunctionalHealth({
      ...baseInput,
      pluginId: 'openclaw-weixin',
      gatewayStatus: { running: true, lastEventAt: 800_000 },
    })).toMatchObject({
      status: 503,
      body: {
        state: 'unfunctional',
        reason: 'gateway-poll-stale',
      },
    });
  });

  it('does not treat generic stale lastEventAt as a functional failure', () => {
    expect(buildFunctionalHealth({
      ...baseInput,
      pluginId: 'generic-plugin',
      gatewayStatus: { running: true, lastEventAt: 800_000 },
    })).toMatchObject({
      status: 200,
      body: {
        state: 'unknown',
        rawLastEventAt: 800_000,
      },
    });
  });

  it('reports stale explicit poll heartbeat as unfunctional for generic plugins', () => {
    expect(buildFunctionalHealth({
      ...baseInput,
      pluginId: 'generic-plugin',
      gatewayStatus: { running: true, lastPollSuccessAt: 800_000 },
    })).toMatchObject({
      status: 503,
      body: {
        state: 'unfunctional',
        reason: 'gateway-poll-stale',
        heartbeatSource: 'lastPollSuccessAt',
      },
    });
  });

  it('keeps quiet plugins with no status in unknown state instead of failing', () => {
    expect(buildFunctionalHealth(baseInput)).toMatchObject({
      status: 200,
      body: { state: 'unknown' },
    });
  });

  it('reports stopped plugin gateway status as unfunctional', () => {
    expect(buildFunctionalHealth({
      ...baseInput,
      gatewayStatus: { running: false },
    })).toMatchObject({
      status: 503,
      body: {
        state: 'unfunctional',
        reason: 'gateway-stopped',
      },
    });
  });

  it('accepts recent explicit heartbeat status as functional', () => {
    expect(buildFunctionalHealth({
      ...baseInput,
      gatewayStatus: { running: true, lastHeartbeatAt: 950_000 },
    })).toMatchObject({
      status: 200,
      body: {
        state: 'functional',
        reason: 'gateway-poll',
      },
    });
  });

  it('does not fail while the plugin is waiting for QR login', () => {
    expect(buildFunctionalHealth({
      ...baseInput,
      gatewayStarted: false,
      waitingForQrLogin: true,
      gatewayStatus: { running: false },
    })).toMatchObject({
      status: 200,
      body: {
        state: 'functional',
        reason: 'awaiting-qr-login',
      },
    });
  });

  it('reports gateway errors as unready and unfunctional', () => {
    expect(buildFunctionalHealth({
      ...baseInput,
      gatewayError: 'boom',
    })).toMatchObject({
      status: 503,
      body: {
        state: 'unready',
        reason: 'gateway-error',
        error: 'boom',
      },
    });
  });
});
