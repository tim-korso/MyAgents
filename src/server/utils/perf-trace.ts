import { performance } from 'node:perf_hooks';

type PerfTraceName =
  | 'sidecar_boot'
  | 'turn'
  | 'runtime'
  | 'storage_io'
  | 'background_job';

type PerfTraceStatus = 'ok' | 'error' | 'timeout' | 'skipped';

export interface PerfTraceEvent {
  trace: PerfTraceName;
  phase: string;
  durationMs?: number;
  sessionId?: string;
  tabId?: string;
  ownerId?: string;
  requestId?: string;
  turnId?: string;
  runtime?: string;
  status?: PerfTraceStatus;
  sizeBytes?: number;
  count?: number;
  detail?: Record<string, string | number | boolean | null | undefined>;
}

function safeValue(value: string | number | boolean | null | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    return String(Math.round(value * 1000) / 1000);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return value
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, '_')
    .slice(0, 160);
}

export function emitPerfTrace(event: PerfTraceEvent): void {
  const fields: Array<[string, string | number | boolean | null | undefined]> = [
    ['trace', event.trace],
    ['phase', event.phase],
    ['durationMs', event.durationMs],
    ['status', event.status],
    ['runtime', event.runtime],
    ['sessionId', event.sessionId],
    ['tabId', event.tabId],
    ['ownerId', event.ownerId],
    ['requestId', event.requestId],
    ['turnId', event.turnId],
    ['sizeBytes', event.sizeBytes],
    ['count', event.count],
  ];

  if (event.detail) {
    for (const [key, value] of Object.entries(event.detail)) {
      fields.push([`detail.${key}`, value]);
    }
  }

  const suffix = fields
    .map(([key, value]) => {
      const safe = safeValue(value);
      return safe === undefined ? undefined : `${key}=${safe}`;
    })
    .filter((part): part is string => !!part)
    .join(' ');

  console.log(`[perf] ${suffix}`);
}

export function nowMs(): number {
  return performance.now();
}

export function elapsedMs(startMs: number): number {
  return Math.round((performance.now() - startMs) * 1000) / 1000;
}

export async function traceAsync<T>(
  event: Omit<PerfTraceEvent, 'durationMs' | 'status'>,
  fn: () => Promise<T>,
): Promise<T> {
  const start = nowMs();
  try {
    const result = await fn();
    emitPerfTrace({ ...event, durationMs: elapsedMs(start), status: 'ok' });
    return result;
  } catch (error) {
    emitPerfTrace({ ...event, durationMs: elapsedMs(start), status: 'error' });
    throw error;
  }
}
