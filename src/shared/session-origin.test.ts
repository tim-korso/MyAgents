import { describe, expect, it } from 'vitest';

import {
  isAutomationHistoryOrigin,
  isSystemMaintenanceSession,
  originAnalyticsFields,
  originFromDesktopSurface,
  originFromMaterializationScenario,
  originFromSessionMetadataLike,
  originFromTurnAttribution,
} from './session-origin';

describe('session-origin', () => {
  it('maps desktop birth surfaces and legacy assistant aliases', () => {
    expect(originFromDesktopSurface('launcher_input')).toEqual({
      kind: 'desktop',
      surface: 'launcher_input',
    });
    expect(originFromDesktopSurface('bug_report')).toEqual({
      kind: 'desktop',
      surface: 'assistant',
    });
  });

  it('normalizes materialization scenarios without keeping legacy im as a kind', () => {
    expect(originFromMaterializationScenario('cron')).toEqual({
      kind: 'automation',
      surface: 'cron',
    });
    expect(originFromMaterializationScenario('im')).toEqual({
      kind: 'agent-channel',
      surface: 'channel_message',
    });
  });

  it('keeps explicit turn attribution over legacy source naming', () => {
    expect(originFromTurnAttribution({ source: 'im' })).toEqual({
      kind: 'agent-channel',
      surface: 'channel_message',
    });
    expect(originFromTurnAttribution({ source: 'floating_ball' })).toEqual({
      kind: 'desktop',
      surface: 'floating_ball',
    });
  });

  it('flattens analytics fields with an unknown fallback', () => {
    expect(originAnalyticsFields({ kind: 'desktop', surface: 'task_center' })).toEqual({
      origin_kind: 'desktop',
      origin_surface: 'task_center',
    });
    expect(originAnalyticsFields({ kind: 'im', surface: 'channel_message' })).toEqual({
      origin_kind: 'unknown',
      origin_surface: 'unknown',
    });
  });

  it('uses durable metadata for automation history filtering', () => {
    expect(isAutomationHistoryOrigin({ kind: 'automation', surface: 'cron' })).toBe(true);
    expect(isAutomationHistoryOrigin({ kind: 'automation', surface: 'task_run' })).toBe(true);
    expect(isAutomationHistoryOrigin({ kind: 'automation', surface: 'memory_update' })).toBe(false);
    expect(isAutomationHistoryOrigin(undefined, { cronTaskId: 'task-1' })).toBe(true);
    expect(isAutomationHistoryOrigin(undefined, { source: 'cron' })).toBe(true);
    expect(isAutomationHistoryOrigin(undefined, { source: 'desktop' })).toBe(false);
  });

  it('hides only explicitly marked system maintenance sessions', () => {
    expect(isSystemMaintenanceSession({ systemMaintenanceKind: 'memory_gardener' })).toBe(true);
    expect(isSystemMaintenanceSession({ systemMaintenanceKind: 'memory_molt' })).toBe(true);
    expect(isSystemMaintenanceSession({
      origin: { kind: 'automation', surface: 'cron' },
      cronTaskId: 'ordinary-cron',
    })).toBe(false);
    expect(isSystemMaintenanceSession({ systemMaintenanceKind: 'memory_auto_update_batch' })).toBe(false);
  });

  it('derives old session metadata conservatively', () => {
    expect(originFromSessionMetadataLike({ source: 'cron' })).toEqual({
      kind: 'automation',
      surface: 'cron',
    });
    expect(originFromSessionMetadataLike({ title: '定时任务' })).toEqual({
      kind: 'unknown',
      surface: 'unknown',
    });
  });
});
