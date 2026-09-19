import { afterEach, describe, expect, it } from 'vitest';

import { imEventBus, type ImEvent } from './im-event-bus';

const TEST_BUFFER_OVERFLOW_COUNT = 20_001;

describe('imEventBus replay filtering', () => {
  afterEach(() => {
    imEventBus.clear();
  });

  it('does not replay stale request events or stale gaps into a fresh request subscriber', () => {
    imEventBus.clear();
    for (let i = 0; i < TEST_BUFFER_OVERFLOW_COUNT; i += 1) {
      imEventBus.emit('old-request', 'delta', `old-${i}`);
    }

    const received: ImEvent[] = [];
    const unsubscribe = imEventBus.subscribe(0, (event) => received.push(event), undefined, 'active-request');
    unsubscribe();

    expect(received).toEqual([]);
  });

  it('replays a scoped gap when the active request itself overflowed', () => {
    imEventBus.clear();
    for (let i = 0; i < TEST_BUFFER_OVERFLOW_COUNT; i += 1) {
      imEventBus.emit('active-request', 'delta', `active-${i}`);
    }

    const received: ImEvent[] = [];
    const unsubscribe = imEventBus.subscribe(0, (event) => received.push(event), undefined, 'active-request');
    unsubscribe();

    expect(received[0]?.type).toBe('gap');
    expect(received[0]?.data).toMatchObject({
      droppedSeqs: expect.any(Array),
      requestIds: ['active-request'],
    });
    expect(received.some((event) => event.requestId === 'old-request')).toBe(false);
  });
});
