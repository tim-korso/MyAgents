import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import { SpaceEnvironmentSwitch } from './SpaceEnvironmentSwitch';

describe('SpaceEnvironmentSwitch', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US');
  });

  it('shows the Dev origin and writes only current environment values', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SpaceEnvironmentSwitch
        activeEnvironment="production"
        origin="https://space-dev.myagents.io"
        onChange={onChange}
      />,
    );

    expect(screen.getByText('Team Service Environment')).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/space-dev\.myagents\.io/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Production' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'Dev' }));

    expect(onChange).toHaveBeenCalledWith('dev');
  });
});
