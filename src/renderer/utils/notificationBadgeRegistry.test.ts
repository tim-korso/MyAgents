import { describe, expect, test } from 'vitest';

import {
  acknowledgeNotificationBadgeTarget,
  buildSessionNotificationBadgeCounts,
  countNotificationBadgeItems,
  isNotificationBadgeTargetVisible,
  normalizeNotificationBadgeIncrementPayload,
  upsertNotificationBadgeItem,
  type NotificationBadgeItem,
} from './notificationBadgeRegistry';

describe('notificationBadgeRegistry', () => {
  test('normalizes a session-targeted badge increment payload', () => {
    expect(
      normalizeNotificationBadgeIncrementPayload(
        {
          id: 'cron:1',
          source: 'cron',
          createdAt: 123,
          target: {
            type: 'session',
            sessionId: ' session-a ',
            workspacePath: ' /ws ',
          },
        },
        'fallback',
        999,
      ),
    ).toEqual({
      id: 'cron:1',
      source: 'cron',
      createdAt: 123,
      target: {
        type: 'session',
        sessionId: 'session-a',
        workspacePath: '/ws',
      },
    });
  });

  test('drops unroutable payloads instead of creating sticky unread state', () => {
    expect(normalizeNotificationBadgeIncrementPayload({}, 'fallback', 999)).toBeNull();
  });

  test('deduplicates increments by id and counts per session', () => {
    const first: NotificationBadgeItem = {
      id: 'a',
      source: 'cron',
      createdAt: 1,
      target: { type: 'session', sessionId: 'session-a' },
    };
    const updated: NotificationBadgeItem = {
      ...first,
      createdAt: 2,
    };
    const second: NotificationBadgeItem = {
      id: 'b',
      source: 'cron',
      createdAt: 3,
      target: { type: 'session', sessionId: 'session-a' },
    };

    const items = upsertNotificationBadgeItem(
      upsertNotificationBadgeItem(
        upsertNotificationBadgeItem([], first),
        updated,
      ),
      second,
    );

    expect(countNotificationBadgeItems(items)).toBe(2);
    expect(items[0]?.createdAt).toBe(2);
    expect(buildSessionNotificationBadgeCounts(items).get('session-a')).toBe(2);
  });

  test('acknowledges only the targeted session', () => {
    const items: NotificationBadgeItem[] = [
      {
        id: 'session-a-1',
        source: 'cron',
        createdAt: 1,
        target: { type: 'session', sessionId: 'session-a' },
      },
      {
        id: 'session-a-2',
        source: 'cron',
        createdAt: 2,
        target: { type: 'session', sessionId: 'session-a' },
      },
      {
        id: 'session-b-1',
        source: 'cron',
        createdAt: 3,
        target: { type: 'session', sessionId: 'session-b' },
      },
    ];

    const remaining = acknowledgeNotificationBadgeTarget(items, {
      type: 'session',
      sessionId: 'session-a',
    });

    expect(remaining).toEqual([items[2]]);
  });

  test('acknowledges all task-center badges when no task id is specified', () => {
    const items: NotificationBadgeItem[] = [
      {
        id: 'task-a',
        source: 'task-center',
        createdAt: 1,
        target: { type: 'task-center', taskId: 'task-a' },
      },
      {
        id: 'task-b',
        source: 'task-center',
        createdAt: 2,
        target: { type: 'task-center', taskId: 'task-b' },
      },
      {
        id: 'session-a',
        source: 'cron',
        createdAt: 3,
        target: { type: 'session', sessionId: 'session-a' },
      },
    ];

    expect(acknowledgeNotificationBadgeTarget(items, { type: 'task-center' })).toEqual([
      items[2],
    ]);
  });

  test('detects when a badge target is already the visible app surface', () => {
    expect(
      isNotificationBadgeTargetVisible(
        { type: 'session', sessionId: 'session-a' },
        { view: 'chat', sessionId: 'session-a' },
      ),
    ).toBe(true);
    expect(
      isNotificationBadgeTargetVisible(
        { type: 'session', sessionId: 'session-a' },
        { view: 'chat', sessionId: 'session-b' },
      ),
    ).toBe(false);
    expect(
      isNotificationBadgeTargetVisible(
        { type: 'task-center' },
        { view: 'taskcenter' },
      ),
    ).toBe(true);
  });
});
