import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import ConfirmDialog from './ConfirmDialog';

describe('ConfirmDialog i18n', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US');
  });

  it('uses translated default action labels', () => {
    render(
      <ConfirmDialog
        title="Delete item"
        message="This cannot be undone."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
  });
});
