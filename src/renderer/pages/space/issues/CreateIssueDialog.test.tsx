import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SpaceSession } from '@/api/spaceCloud';
import type { SpaceActions } from '@/pages/space/spaceStore';
import { CreateIssueDialog } from './CreateIssueDialog';

const openFileDialog = vi.fn();
const invokeTauri = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeTauri(...args),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: (...args: unknown[]) => openFileDialog(...args),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}));

beforeEach(() => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
});

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  vi.clearAllMocks();
});

const session: SpaceSession = {
  baseUrl: 'https://space.myagents.test',
  user: { id: 'u-1', email: 'user@example.com', name: 'Ethan' },
  space: { id: 'space-1', slug: 'official', name: 'Official Space', joinPolicy: 'open' },
  membership: { id: 'membership-1', role: 'owner' },
  updatedAt: '2026-07-12T00:00:00.000Z',
};

describe('CreateIssueDialog', () => {
  it('keeps selected files in the draft and submits them with Issue creation', async () => {
    const user = userEvent.setup();
    const createIssue = vi.fn().mockResolvedValue({ id: 'iss-1' });
    const uploadIssueAttachments = vi.fn();
    const onCreated = vi.fn();
    openFileDialog.mockResolvedValueOnce(['/workspace/screenshot.png']);
    invokeTauri.mockResolvedValueOnce([{
      path: '/workspace/screenshot.png',
      name: 'screenshot.png',
      sizeBytes: 2048,
      mimeType: 'image/png',
    }]);

    render(
      <CreateIssueDialog
        goals={[]}
        actions={{
          createIssue,
          uploadIssueAttachments,
          refreshIssues: vi.fn().mockResolvedValue(undefined),
        } as unknown as SpaceActions}
        issueQuery={{}}
        session={session}
        registeredAgents={[]}
        onClose={vi.fn()}
        onCreated={onCreated}
      />,
    );

    await user.type(screen.getByPlaceholderText('Issue title'), 'Attachment ownership');
    await user.type(screen.getByPlaceholderText('Add description...'), 'Keep this file on the Issue body.');
    await user.click(screen.getByRole('button', { name: '添加附件' }));
    expect(await screen.findByText('screenshot.png')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '创建' }));

    expect(createIssue).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Attachment ownership',
      body: 'Keep this file on the Issue body.',
      filePaths: ['/workspace/screenshot.png'],
    }));
    expect(uploadIssueAttachments).not.toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledWith(false);
  });

  it('cannot submit while attachment inspection is pending, then submits the inspected file once', async () => {
    const user = userEvent.setup();
    const createIssue = vi.fn().mockResolvedValue({ id: 'iss-1' });
    let resolveInspection!: (value: unknown) => void;
    openFileDialog.mockResolvedValueOnce(['/workspace/pending.log']);
    invokeTauri.mockReturnValueOnce(new Promise(resolve => {
      resolveInspection = resolve;
    }));

    render(
      <CreateIssueDialog
        goals={[]}
        actions={{
          createIssue,
          refreshIssues: vi.fn().mockResolvedValue(undefined),
        } as unknown as SpaceActions}
        issueQuery={{}}
        session={session}
        registeredAgents={[]}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );

    await user.type(screen.getByPlaceholderText('Issue title'), 'Wait for inspection');
    await user.type(screen.getByPlaceholderText('Add description...'), 'Do not lose the selected attachment.');
    await user.click(screen.getByRole('button', { name: '添加附件' }));
    const createButton = screen.getByRole('button', { name: '创建' });
    expect(createButton).toBeDisabled();
    await user.click(createButton);
    expect(createIssue).not.toHaveBeenCalled();

    await act(async () => {
      resolveInspection([{
        path: '/workspace/pending.log',
        name: 'pending.log',
        sizeBytes: 512,
        mimeType: 'text/plain',
      }]);
    });
    expect(await screen.findByText('pending.log')).toBeInTheDocument();
    expect(createButton).toBeEnabled();
    await user.click(createButton);

    expect(createIssue).toHaveBeenCalledTimes(1);
    expect(createIssue).toHaveBeenCalledWith(expect.objectContaining({
      filePaths: ['/workspace/pending.log'],
    }));
  });
});
