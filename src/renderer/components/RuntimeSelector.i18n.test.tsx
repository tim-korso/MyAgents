import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import type { RuntimeDetections } from '@/../shared/types/runtime';
import RuntimeSelector from './RuntimeSelector';

const detections: RuntimeDetections = {
  builtin: { installed: true },
  'claude-code': { installed: true, version: '1.0.0' },
  codex: { installed: true, version: '1.0.0' },
  gemini: { installed: false },
};

describe('RuntimeSelector i18n', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US');
  });

  it('renders toolbar menu chrome in English', async () => {
    const user = userEvent.setup();
    render(
      <RuntimeSelector
        value="codex"
        detections={detections}
        onChange={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    await user.click(screen.getByTitle('Runtime: Codex CLI'));

    expect(screen.getByText('Runtime')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Settings/ })).toBeInTheDocument();
    expect(screen.getByText('Not installed')).toBeInTheDocument();
  });
});
