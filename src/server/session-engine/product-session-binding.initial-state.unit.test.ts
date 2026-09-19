import { describe, expect, it } from 'vitest';

import {
  currentProductSessionId,
  resetProductSessionBinding,
} from './product-session-binding';

describe('product Session binding birth', () => {
  it('stays unbound until Session bootstrap or an adapter explicitly selects an identity', async () => {
    expect(currentProductSessionId).toBe('');
    expect(process.env.MYAGENTS_SESSION_ID).toBeUndefined();

    const sessionId = await resetProductSessionBinding({ workspacePath: '/workspace' });

    expect(sessionId).not.toBe('');
    expect(currentProductSessionId).toBe(sessionId);
    expect(process.env.MYAGENTS_SESSION_ID).toBe(sessionId);
  });
});
