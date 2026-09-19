export type GatewayRuntimeStatus = Record<string, unknown>;

export type GatewayHealthInput = {
  pluginLoaded: boolean;
  gatewayError: string | null;
  gatewayStarted: boolean;
  waitingForQrLogin: boolean;
  hasGateway: boolean;
  pluginName?: string;
  pluginId?: string;
  gatewayStatus?: GatewayRuntimeStatus | null;
  lastForwardAt?: number;
  nowMs?: number;
  stalenessMs?: number;
};

export type GatewayHealthResult = {
  status: number;
  body: Record<string, unknown>;
};

const DEFAULT_STALENESS_MS = 90_000;
const LAST_EVENT_IS_POLL_HEARTBEAT_PLUGIN_IDS = new Set(['openclaw-weixin']);

function readyFailureReason(input: GatewayHealthInput): string {
  if (!input.pluginLoaded) return 'plugin-not-loaded';
  if (input.gatewayError) return 'gateway-error';
  return 'gateway-not-started';
}

function numericTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeGatewayStatus(input: GatewayHealthInput): {
  lastPollSuccessAt: number | null;
  lastInboundAt: number | null;
  rawLastEventAt: number | null;
  heartbeatSource: string | null;
} {
  const status = input.gatewayStatus;
  const explicitPoll = numericTimestamp(status?.lastPollSuccessAt);
  if (explicitPoll !== null) {
    return {
      lastPollSuccessAt: explicitPoll,
      lastInboundAt: numericTimestamp(status?.lastInboundAt),
      rawLastEventAt: numericTimestamp(status?.lastEventAt),
      heartbeatSource: 'lastPollSuccessAt',
    };
  }

  const heartbeat = numericTimestamp(status?.lastHeartbeatAt);
  if (heartbeat !== null) {
    return {
      lastPollSuccessAt: heartbeat,
      lastInboundAt: numericTimestamp(status?.lastInboundAt),
      rawLastEventAt: numericTimestamp(status?.lastEventAt),
      heartbeatSource: 'lastHeartbeatAt',
    };
  }

  const rawLastEventAt = numericTimestamp(status?.lastEventAt);
  if (
    rawLastEventAt !== null
    && input.pluginId
    && LAST_EVENT_IS_POLL_HEARTBEAT_PLUGIN_IDS.has(input.pluginId)
  ) {
    return {
      lastPollSuccessAt: rawLastEventAt,
      lastInboundAt: numericTimestamp(status?.lastInboundAt),
      rawLastEventAt,
      heartbeatSource: 'lastEventAt:openclaw-weixin',
    };
  }

  return {
    lastPollSuccessAt: null,
    lastInboundAt: numericTimestamp(status?.lastInboundAt),
    rawLastEventAt,
    heartbeatSource: null,
  };
}

export function buildReadyHealth(input: GatewayHealthInput): GatewayHealthResult {
  const ready = input.pluginLoaded
    && !input.gatewayError
    && (input.gatewayStarted || input.waitingForQrLogin);

  if (ready) {
    return {
      status: 200,
      body: {
        state: 'ready',
        pluginName: input.pluginName,
        waitingForQrLogin: input.waitingForQrLogin,
      },
    };
  }

  return {
    status: 503,
    body: {
      state: 'pending',
      reason: readyFailureReason(input),
      pluginName: input.pluginName,
      error: input.gatewayError || undefined,
      waitingForQrLogin: input.waitingForQrLogin,
    },
  };
}

export function buildFunctionalHealth(input: GatewayHealthInput): GatewayHealthResult {
  const ready = buildReadyHealth(input);
  if (ready.status !== 200) {
    return {
      status: 503,
      body: {
        state: 'unready',
        reason: ready.body.reason,
        error: input.gatewayError || undefined,
      },
    };
  }

  if (!input.hasGateway) {
    return { status: 200, body: { state: 'functional', reason: 'send-only' } };
  }

  if (input.waitingForQrLogin) {
    return { status: 200, body: { state: 'functional', reason: 'awaiting-qr-login' } };
  }

  const status = input.gatewayStatus;
  if (status?.running === false) {
    return {
      status: 503,
      body: {
        state: 'unfunctional',
        reason: 'gateway-stopped',
      },
    };
  }

  const nowMs = input.nowMs ?? Date.now();
  const stalenessMs = input.stalenessMs ?? DEFAULT_STALENESS_MS;
  const normalized = normalizeGatewayStatus(input);
  if (normalized.lastPollSuccessAt !== null) {
    const gatewayPollMsAgo = nowMs - normalized.lastPollSuccessAt;
    if (gatewayPollMsAgo <= stalenessMs) {
      return {
        status: 200,
        body: {
          state: 'functional',
          reason: 'gateway-poll',
          gatewayPollMsAgo,
          heartbeatSource: normalized.heartbeatSource,
          lastInboundAt: normalized.lastInboundAt ?? undefined,
          rawLastEventAt: normalized.rawLastEventAt ?? undefined,
        },
      };
    }

    return {
      status: 503,
      body: {
        state: 'unfunctional',
        reason: 'gateway-poll-stale',
        gatewayPollMsAgo,
        heartbeatSource: normalized.heartbeatSource,
        lastInboundAt: normalized.lastInboundAt ?? undefined,
        rawLastEventAt: normalized.rawLastEventAt ?? undefined,
        message: `no successful gateway poll in the last ${stalenessMs}ms`,
      },
    };
  }

  const lastForward = numericTimestamp(input.lastForwardAt);
  const lastForwardMsAgo = lastForward !== null ? nowMs - lastForward : null;
  if (lastForwardMsAgo !== null && lastForwardMsAgo <= stalenessMs) {
    return {
      status: 200,
      body: {
        state: 'functional',
        reason: 'recent-forward',
        lastForwardMsAgo,
      },
    };
  }

  return {
    status: 200,
    body: {
      state: lastForwardMsAgo === null ? 'unknown' : 'stale',
      lastForwardMsAgo,
      lastInboundAt: normalized.lastInboundAt ?? undefined,
      rawLastEventAt: normalized.rawLastEventAt ?? undefined,
      message: `no successful forward in the last ${stalenessMs}ms`,
    },
  };
}
