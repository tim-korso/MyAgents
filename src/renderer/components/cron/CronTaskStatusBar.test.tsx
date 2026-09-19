import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { i18n } from '@/i18n';
import CronTaskStatusBar from './CronTaskStatusBar';

describe('CronTaskStatusBar', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US');
  });

  it('renders only Cron-owned schedule state', () => {
    render(
      <CronTaskStatusBar mode="draft" intervalMinutes={5} />,
    );
    expect(screen.getByText('Scheduled mode')).toBeInTheDocument();
    expect(screen.queryByText('Goal Mode')).not.toBeInTheDocument();
    expect(screen.getByText('Run every 5 minutes')).toBeInTheDocument();
  });
});
