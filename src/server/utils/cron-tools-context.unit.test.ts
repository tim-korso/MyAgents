import { afterEach, describe, expect, it } from 'vitest';

import {
  clearAllCronTaskContexts,
  clearCronTaskContext,
  consumeCronTaskExitRequest,
  markCronTaskExitRequested,
  setCronTaskContext,
} from '../tools/cron-tools';

describe('cron-tools exit request state', () => {
  afterEach(() => {
    clearAllCronTaskContexts();
  });

  it('records and consumes an exit request for the active cron session', () => {
    setCronTaskContext('cron_123', true, 'session_123');

    const marked = markCronTaskExitRequested('goal achieved', 'session_123');
    expect(marked).toMatchObject({
      taskId: 'cron_123',
      reason: 'goal achieved',
    });
    expect(marked?.timestamp).toEqual(expect.any(String));

    expect(consumeCronTaskExitRequest('session_123')).toEqual(marked);
    expect(consumeCronTaskExitRequest('session_123')).toBeNull();
  });

  it('keeps exit requests across cron context cleanup until the executor consumes them', () => {
    setCronTaskContext('cron_123', true, 'session_123');
    const marked = markCronTaskExitRequested('goal achieved', 'session_123');

    clearCronTaskContext('session_123');

    expect(consumeCronTaskExitRequest('session_123')).toEqual(marked);
    expect(consumeCronTaskExitRequest('session_123')).toBeNull();
  });

  it('drops stale exit requests when a new execution starts for the same session', () => {
    setCronTaskContext('cron_123', true, 'session_123');
    markCronTaskExitRequested('stale request', 'session_123');

    setCronTaskContext('cron_123', true, 'session_123');

    expect(consumeCronTaskExitRequest('session_123')).toBeNull();
  });
});
