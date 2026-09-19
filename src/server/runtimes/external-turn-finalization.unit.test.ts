import { describe, expect, it, vi } from 'vitest';

import { TurnFinalizationGate } from './external-turn-finalization';

/** Manually-controlled promise standing in for persistTurnResult(). */
function deferred() {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('TurnFinalizationGate — external turn finalization ordering (cross-review 0.2.32 Codex Critical 1+2)', () => {
  it('Critical 1: settled() does not release while finalization is in flight (idle must not early-return before the assistant message lands)', async () => {
    const gate = new TurnFinalizationGate();
    const persist = deferred();
    gate.track(persist.promise);

    // Simulates cron/IM heartbeat awaiting idle: turnCompleted is already true,
    // but the assistant push (inside persistTurnResult) has not happened yet.
    let released = false;
    const waiter = gate.settled().then(() => {
      released = true;
    });
    await Promise.resolve(); // flush microtasks — must NOT release yet
    expect(released).toBe(false);
    expect(gate.inFlight).toBe(true);

    persist.resolve(); // assistant message now in allSessionMessages
    await waiter;
    expect(released).toBe(true);
    expect(gate.inFlight).toBe(false);
  });

  it('Critical 2: inFlight stays true through the await window so the next turn cannot reset accumulators mid-finalization', async () => {
    const gate = new TurnFinalizationGate();
    const persist = deferred();
    gate.track(persist.promise);

    // sendExternalMessage's pre-dispatch check
    expect(gate.inFlight).toBe(true);
    persist.resolve();
    await gate.settled();
    expect(gate.inFlight).toBe(false);
  });

  it('a rejected finalization still releases the gate (fire-and-forget .catch owns logging; the gate must not deadlock the session)', async () => {
    const gate = new TurnFinalizationGate();
    const persist = deferred();
    gate.track(persist.promise.catch(() => undefined));

    persist.reject(new Error('disk full'));
    await expect(gate.settled()).resolves.toBe(true);
    expect(gate.inFlight).toBe(false);
  });

  it('settled(timeoutMs) resolves false when finalization hangs (busy-gate callers keep their own deadline semantics)', async () => {
    vi.useFakeTimers();
    try {
      const gate = new TurnFinalizationGate();
      const persist = deferred();
      gate.track(persist.promise);

      const result = gate.settled(5_000);
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(result).resolves.toBe(false);
      expect(gate.inFlight).toBe(true); // still hung — caller decides degraded path

      // A later waiter still releases normally once the hang clears.
      persist.resolve();
      await expect(gate.settled(1)).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('settled() with nothing in flight resolves true immediately', async () => {
    const gate = new TurnFinalizationGate();
    await expect(gate.settled()).resolves.toBe(true);
    await expect(gate.settled(0)).resolves.toBe(true);
  });

  it('timed-out settled() removes its waiter (no dead-closure accumulation across repeated sends during one stuck finalization — cross-review 0.2.33 Codex)', async () => {
    vi.useFakeTimers();
    try {
      const gate = new TurnFinalizationGate();
      const persist = deferred();
      gate.track(persist.promise);

      // Three sends time out against the same hung finalization.
      for (let i = 0; i < 3; i++) {
        const result = gate.settled(1_000);
        await vi.advanceTimersByTimeAsync(1_000);
        await expect(result).resolves.toBe(false);
      }
      // Internal waiter list must not have accumulated the dead closures.
      expect(
        (gate as unknown as { waiters: unknown[] }).waiters,
      ).toHaveLength(0);

      persist.resolve();
      await expect(gate.settled(1)).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('overlapping tracks release only after ALL settle (turn_complete + session_complete both firing persistTurnResult)', async () => {
    const gate = new TurnFinalizationGate();
    const a = deferred();
    const b = deferred();
    gate.track(a.promise);
    gate.track(b.promise);

    a.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(gate.inFlight).toBe(true);

    b.resolve();
    await gate.settled();
    expect(gate.inFlight).toBe(false);
  });
});
