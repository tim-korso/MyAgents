import { afterEach, describe, expect, it } from 'vitest';

import {
  birthContextForSurface,
  clearPendingSessionBirth,
  consumePendingSessionBirth,
  consumePendingSurface,
  peekPendingSessionBirth,
  setPendingSessionBirth,
  setPendingSurface,
} from './pendingSurface';

const TAB_A = 'tab-a';
const TAB_B = 'tab-b';

describe('pending session birth context', () => {
  afterEach(() => {
    clearPendingSessionBirth(TAB_A);
    clearPendingSessionBirth(TAB_B);
  });

  it('maps known surfaces to explicit entry intent and initial-message state', () => {
    expect(birthContextForSurface('launcher_input')).toEqual({
      surface: 'launcher_input',
      entryIntent: 'send_message',
      hasInitialMessage: true,
    });
    expect(birthContextForSurface('agent_card')).toEqual({
      surface: 'agent_card',
      entryIntent: 'open_workspace',
      hasInitialMessage: false,
    });
    expect(birthContextForSurface('task_center')).toEqual({
      surface: 'task_center',
      entryIntent: 'thought_alignment',
      hasInitialMessage: true,
    });
    expect(birthContextForSurface('bug_report')).toEqual({
      surface: 'bug_report',
      entryIntent: 'support_diagnostics',
      hasInitialMessage: true,
      assistantEntry: 'support_diagnostics',
    });
  });

  it('consumes each tab birth context exactly once', () => {
    const fallback = birthContextForSurface('new_chat_button');
    setPendingSessionBirth(TAB_A, {
      surface: 'agent_setup',
      entryIntent: 'workspace_init',
      hasInitialMessage: true,
      assistantEntry: 'settings',
    });
    setPendingSessionBirth(TAB_B, {
      surface: 'history_click',
      entryIntent: 'open_history',
      hasInitialMessage: false,
    });

    expect(consumePendingSessionBirth(TAB_A, fallback)).toEqual({
      surface: 'agent_setup',
      entryIntent: 'workspace_init',
      hasInitialMessage: true,
      assistantEntry: 'settings',
    });
    expect(consumePendingSessionBirth(TAB_A, fallback)).toBe(fallback);
    expect(consumePendingSessionBirth(TAB_B, fallback).surface).toBe('history_click');
  });

  it('peeks without consuming the pending birth context', () => {
    const fallback = birthContextForSurface('new_chat_button');
    const context = birthContextForSurface('launcher_input');
    setPendingSessionBirth(TAB_A, context);

    expect(peekPendingSessionBirth(TAB_A, fallback)).toBe(context);
    expect(peekPendingSessionBirth(TAB_A, fallback)).toBe(context);
    expect(consumePendingSessionBirth(TAB_A, fallback)).toBe(context);
    expect(peekPendingSessionBirth(TAB_A, fallback)).toBe(fallback);
  });

  it('keeps the legacy surface wrapper compatible while new callers use full context', () => {
    setPendingSurface(TAB_A, 'launcher_input');

    expect(consumePendingSurface(TAB_A, 'unknown')).toBe('launcher_input');
    expect(consumePendingSurface(TAB_A, 'unknown')).toBe('unknown');
  });
});
