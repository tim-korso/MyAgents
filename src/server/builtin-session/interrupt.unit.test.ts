import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBuiltinInterruptController } from './interrupt';
import type { InterruptReceipt } from '../utils/inflight-terminal';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  const receipts = [deferred<InterruptReceipt | undefined>(), deferred<InterruptReceipt | undefined>()];
  const query = { interrupt: vi.fn().mockReturnValueOnce(receipts[0].promise).mockReturnValueOnce(receipts[1].promise) };
  let currentQuery: typeof query | null = query;
  let queueId: string | null = 'queued-B';
  const deps = {
    getQuery: () => currentQuery,
    getInFlightQueueId: () => queueId,
    setInterruptingQueueId: vi.fn(),
    dropCancelledInFlight: vi.fn(() => { queueId = null; }),
    scheduleDrain: vi.fn(),
    forceClose: vi.fn(() => { currentQuery = null; }),
    finishStopped: vi.fn(),
  };
  return { query, receipts, deps, controller: createBuiltinInterruptController(deps),
    replaceQuery: () => { currentQuery = { interrupt: vi.fn() }; },
    clearQuery: () => { currentQuery = null; },
    setQueue: (id: string | null) => { queueId = id; },
  };
}

describe('builtin interrupt request ownership', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('shares the pending operation only until its target terminal, then interrupts B immediately', async () => {
    const { controller, query, receipts, deps } = setup();
    const a = controller.interrupt();
    expect(controller.interrupt()).toBe(a);
    expect(query.interrupt).toHaveBeenCalledTimes(1);
    controller.settleTerminal(query, 'result-claimed');
    expect(controller.isInterrupting()).toBe(false);
    const b = controller.interrupt();
    expect(query.interrupt).toHaveBeenCalledTimes(2);
    await a;
    expect(controller.isInterrupting()).toBe(true);
    expect(deps.setInterruptingQueueId).not.toHaveBeenCalledWith(null);
    receipts[0].resolve({ still_queued: [] });
    await Promise.resolve();
    expect(deps.dropCancelledInFlight).not.toHaveBeenCalled();
    controller.settleTerminal(query, 'result-claimed');
    await b;
    expect(deps.forceClose).not.toHaveBeenCalled();
    expect(deps.finishStopped).not.toHaveBeenCalled();
  });

  it('still reconciles an exact queued survivor after result-first completion', async () => {
    const { controller, query, receipts, deps } = setup();
    const stop = controller.interrupt();
    controller.settleTerminal(query, 'result-claimed');
    await stop;
    receipts[0].resolve({ still_queued: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.dropCancelledInFlight).toHaveBeenCalledOnce();
    expect(deps.scheduleDrain).toHaveBeenCalledOnce();
  });

  it('does not cancel a consumed or different queued item from a late receipt', async () => {
    const { controller, query, receipts, deps, setQueue } = setup();
    const stop = controller.interrupt();
    controller.settleTerminal(query, 'result-claimed');
    await stop;
    setQueue('queued-C');
    receipts[0].resolve({ still_queued: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.dropCancelledInFlight).not.toHaveBeenCalled();
  });

  it('logs a late rejected control request without closing the successor', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { controller, query, receipts, deps } = setup();
    const stop = controller.interrupt();
    controller.settleTerminal(query, 'result-claimed');
    await stop;
    const error = new Error('control transport failed');
    receipts[0].reject(error);
    await vi.advanceTimersByTimeAsync(5000);
    expect(log).toHaveBeenCalledWith('[agent] Interrupt request failed:', error);
    expect(deps.forceClose).not.toHaveBeenCalled();
    expect(deps.finishStopped).not.toHaveBeenCalled();
  });

  it.each(['reject', 'timeout'] as const)('still force-closes a genuinely unresponsive target (%s)', async mode => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { controller, receipts, deps, query } = setup();
    const stop = controller.interrupt();
    if (mode === 'reject') receipts[0].reject(new Error('failed'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(await stop).toBe(true);
    expect(log).toHaveBeenCalled();
    expect(deps.forceClose).toHaveBeenCalledWith(query, 'receipt');
    expect(deps.finishStopped).toHaveBeenCalledOnce();
    expect(controller.isInterrupting()).toBe(false);
  });

  it('still requires terminal after receipt and force-closes after the 3s bound', async () => {
    const { controller, receipts, deps, query } = setup();
    const stop = controller.interrupt();
    receipts[0].resolve({ still_queued: ['queued-B'] });
    await vi.advanceTimersByTimeAsync(2999);
    expect(deps.forceClose).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await stop;
    expect(deps.forceClose).toHaveBeenCalledWith(query, 'terminal');
    expect(deps.finishStopped).toHaveBeenCalledOnce();
  });

  it('completes a receipt-first graceful stop without duplicate terminalization', async () => {
    const { controller, query, receipts, deps } = setup();
    const stop = controller.interrupt();
    receipts[0].resolve({ still_queued: ['queued-B'] });
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.isInterrupting()).toBe(true);
    expect(controller.didInFlightSurvive('queued-B')).toBe(true);
    controller.settleTerminal(query, 'result-claimed');
    await stop;
    expect(deps.finishStopped).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('claims no-result session exit before Query cleanup, without waiting for receipt', async () => {
    const { controller, query, deps, clearQuery } = setup();
    const stop = controller.interrupt();
    controller.settleTerminal(query, 'session-ended');
    expect(deps.finishStopped).toHaveBeenCalledOnce();
    clearQuery();
    expect(await stop).toBe(true);
    expect(deps.forceClose).not.toHaveBeenCalled();
  });

  it.each(['receipt', 'reject', 'timeout'] as const)('never settles or closes a replacement Query (%s)', async mode => {
    const { controller, receipts, deps, replaceQuery } = setup();
    const stop = controller.interrupt();
    replaceQuery();
    if (mode === 'receipt') receipts[0].resolve({ still_queued: [] });
    if (mode === 'reject') receipts[0].reject(new Error('old Query failed'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(await stop).toBe(false);
    expect(deps.forceClose).not.toHaveBeenCalled();
    expect(deps.finishStopped).not.toHaveBeenCalled();
    expect(deps.dropCancelledInFlight).not.toHaveBeenCalled();
  });
});
