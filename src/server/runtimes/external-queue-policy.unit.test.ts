import { describe, it, expect } from 'vitest';
import { shouldQueueExternalSend, canDrainExternalQueue } from './external-queue-policy';

describe('shouldQueueExternalSend (defer mid-turn sends into the queue)', () => {
  it('running → defer (a turn is in flight; Codex would otherwise start a 2nd turn)', () => {
    expect(shouldQueueExternalSend({
      state: 'running',
      queueLength: 0,
      responseMode: 'turn',
      canSteerActiveTurn: true,
    })).toBe(true);
    expect(shouldQueueExternalSend({
      state: 'running',
      queueLength: 0,
      responseMode: 'realtime',
      canSteerActiveTurn: false,
    })).toBe(true);
  });
  it('running + realtime + steer capability → send immediately', () => {
    expect(shouldQueueExternalSend({
      state: 'running',
      queueLength: 0,
      responseMode: 'realtime',
      canSteerActiveTurn: true,
    })).toBe(false);
  });
  it('idle + empty queue → send immediately', () => {
    expect(shouldQueueExternalSend({
      state: 'idle',
      queueLength: 0,
      responseMode: 'turn',
      canSteerActiveTurn: false,
    })).toBe(false);
  });
  it('idle + non-empty queue → defer (preserve FIFO behind the pending item)', () => {
    expect(shouldQueueExternalSend({
      state: 'idle',
      queueLength: 1,
      responseMode: 'realtime',
      canSteerActiveTurn: true,
    })).toBe(true);
  });
  it('error + empty → send immediately (start fresh)', () => {
    expect(shouldQueueExternalSend({
      state: 'error',
      queueLength: 0,
      responseMode: 'turn',
      canSteerActiveTurn: false,
    })).toBe(false);
  });
});

describe('canDrainExternalQueue (turn-end drain eligibility)', () => {
  it('idle + queued → drain one', () => {
    expect(canDrainExternalQueue('idle', 1)).toBe(true);
  });
  it('running + queued → NOT yet (wait for turn end)', () => {
    expect(canDrainExternalQueue('running', 2)).toBe(false);
  });
  it('idle + empty → nothing to do', () => {
    expect(canDrainExternalQueue('idle', 0)).toBe(false);
  });
  it('error + queued → not drained on the error idle path here', () => {
    expect(canDrainExternalQueue('error', 1)).toBe(false);
  });
});
