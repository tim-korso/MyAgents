import { describe, expect, it } from 'vitest';

import {
  LIVE_USER_ECHO_REPLAY_KIND,
  createLiveUserMessageReplay,
} from './chatMessageReplay';

describe('createLiveUserMessageReplay', () => {
  it('stamps the live turn barrier with its source session', () => {
    const message = { id: 'user-1', content: 'hello' };

    expect(createLiveUserMessageReplay('session-current', message)).toEqual({
      message,
      replayKind: LIVE_USER_ECHO_REPLAY_KIND,
      sessionId: 'session-current',
    });
  });
});
