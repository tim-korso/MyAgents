import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import type { CronTask } from '@/types/cronTask';
import {
  formatCronIntervalLabel,
  formatCronNextExecution,
  formatCronResumeBlockReason,
  formatCronScheduleDescription,
} from './cronTaskI18n';

function task(partial: Partial<CronTask>): CronTask {
  return {
    id: 'cron-1',
    workspacePath: '/tmp/workspace',
    sessionId: 'session-1',
    prompt: 'Run the report',
    intervalMinutes: 30,
    endConditions: { aiCanExit: false },
    runMode: 'single_session',
    status: 'running',
    executionCount: 0,
    createdAt: new Date().toISOString(),
    notifyEnabled: true,
    ...partial,
  };
}

describe('cronTaskI18n', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats recurring cron chrome in English', async () => {
    await i18n.changeLanguage('en-US');
    const t = i18n.getFixedT('en-US', 'task');

    expect(formatCronIntervalLabel(125, t)).toBe('2 hours 5 minutes');
    expect(formatCronScheduleDescription(task({ schedule: { kind: 'every', minutes: 120 } }), t, 'en-US')).toBe('Every 2 hours');
  });

  it('keeps Chinese fallback output available', async () => {
    await i18n.changeLanguage('zh-CN');
    const t = i18n.getFixedT('zh-CN', 'task');

    expect(formatCronIntervalLabel(125, t)).toBe('2 小时 5 分钟');
    expect(formatCronScheduleDescription(task({ schedule: { kind: 'every', minutes: 120 } }), t, 'zh-CN')).toBe('每 2 小时');
  });

  it('formats next execution and resume block reasons from task resources', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    await i18n.changeLanguage('en-US');
    const t = i18n.getFixedT('en-US', 'task');

    expect(formatCronNextExecution('2026-01-01T02:05:00Z', 'running', t, 'en-US')).toBe('In 2 hours');
    expect(formatCronResumeBlockReason(task({
      status: 'stopped',
      executionCount: 5,
      endConditions: { aiCanExit: false, maxExecutions: 5 },
    }), t)).toBe('Maximum run count reached');
  });
});
