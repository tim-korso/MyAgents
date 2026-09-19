import { describe, expect, it } from 'vitest';

import {
  ackPendingSessionWatch,
  clearPendingSessionWatchesForTest,
  listPendingSessionWatches,
  pendingSessionWatchCount,
  registerPendingSessionWatch,
} from './watch-registry';

describe('session watch registry', () => {
  it('lists watches without dropping them and removes them on ack', () => {
    clearPendingSessionWatchesForTest();
    registerPendingSessionWatch({
      watchId: 'watch-1',
      watcherSessionId: 'session-a',
      targetSessionId: 'session-b',
      targetLabel: 'B',
      targetStateAtRegistration: 'running',
      registeredAt: '2026-06-20T12:00:00.000Z',
    });

    expect(pendingSessionWatchCount()).toBe(1);
    expect(listPendingSessionWatches()).toHaveLength(1);
    expect(pendingSessionWatchCount()).toBe(1);
    ackPendingSessionWatch('watch-1');
    expect(pendingSessionWatchCount()).toBe(0);
  });
});
