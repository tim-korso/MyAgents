import { describe, expect, it } from 'vitest';

import {
  getActiveFrontendLogTabIdForTest,
  setAppActiveTabId,
  setCurrentTabId,
  setFocusedTabId,
} from './frontendLogger';

describe('frontendLogger active tab correlation', () => {
  it('prefers the App active tab when the active surface has no TabProvider', () => {
    setCurrentTabId('old-chat-tab', true);
    setFocusedTabId('old-chat-tab');

    setAppActiveTabId('new-launcher-tab', ['old-chat-tab', 'new-launcher-tab']);

    expect(getActiveFrontendLogTabIdForTest()).toBe('new-launcher-tab');

    setCurrentTabId('old-chat-tab', false);

    expect(getActiveFrontendLogTabIdForTest()).toBe('new-launcher-tab');
  });
});
