import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import CronTaskSettingsModal, { type CronInitialConfig } from './CronTaskSettingsModal';

vi.mock('@/hooks/useDeliveryChannels', () => ({
  useDeliveryChannels: () => ({
    options: [],
    hasChannels: false,
    resolveDelivery: vi.fn(),
  }),
}));

const legacyLoopConfig: CronInitialConfig = {
  taskKind: 'cron',
  prompt: 'legacy loop',
  intervalMinutes: 5,
  endConditions: { aiCanExit: true },
  runMode: 'single_session',
  notifyEnabled: true,
  schedule: { kind: 'loop' },
  executionTarget: 'current_session',
};

describe('CronTaskSettingsModal taskKind', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US');
  });

  it('keeps a legacy Loop ordinary when explicit Goal state is absent', () => {
    const onConfirm = vi.fn();
    render(
      <CronTaskSettingsModal
        isOpen
        onClose={vi.fn()}
        onConfirm={onConfirm}
        initialPrompt="legacy loop"
        initialConfig={legacyLoopConfig}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Scheduled task' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      taskKind: 'cron',
      schedule: { kind: 'loop' },
    }));
  });

  it('round-trips the explicit Goal creation surface', () => {
    const onConfirm = vi.fn();
    render(
      <CronTaskSettingsModal
        isOpen
        onClose={vi.fn()}
        onConfirm={onConfirm}
        initialPrompt="finish release"
        initialConfig={{ ...legacyLoopConfig, taskKind: 'goal' }}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Goal Loop' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      taskKind: 'goal',
      runMode: 'single_session',
    }));
  });
});
