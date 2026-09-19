import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getSessions: vi.fn(),
    getSessionUserTags: vi.fn(),
    mutateSessionUserTagAssignment: vi.fn(),
    mutateGlobalSessionUserTag: vi.fn(),
}));

vi.mock('@/api/sessionClient', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/api/sessionClient')>();
    return { ...actual, ...mocks };
});

import { i18n } from '@/i18n';
import { SessionUserTagApiError } from '@/api/sessionClient';
import SessionTagMenuItem from './SessionTagMenuItem';

describe('SessionTagMenuItem', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        await i18n.changeLanguage('zh-CN');
        mocks.getSessionUserTags.mockResolvedValue([
            { name: 'Alpha', count: 2 },
            { name: 'Beta', count: 1 },
        ]);
        mocks.getSessions.mockResolvedValue([]);
    });

    it.each([
        { isComposing: true, keyCode: 13 },
        { isComposing: false, keyCode: 229 },
    ])('does not create a Tag when Enter commits IME text: %j', async (ime) => {
        mocks.mutateSessionUserTagAssignment.mockResolvedValue({
            action: 'updated', affectedSessionCount: 1,
            tags: [{ name: 'ceshi', count: 1 }],
            session: { id: 'session-1', userTags: ['ceshi'] },
        });
        render(<SessionTagMenuItem session={{ id: 'session-1' }}
            onMutationStart={vi.fn(() => 1)} onSessionUpdated={vi.fn(() => true)} />);
        fireEvent.click(screen.getByRole('button', { name: i18n.t('common:sessionTags.addTag') }));
        await screen.findByRole('menuitemcheckbox', { name: /Alpha/ });
        const input = screen.getByRole('textbox', { name: i18n.t('common:sessionTags.searchTags') });
        fireEvent.compositionStart(input);
        fireEvent.change(input, { target: { value: 'ceshi' } });
        if (!ime.isComposing) fireEvent.compositionEnd(input);
        fireEvent.keyDown(input, { key: 'Enter', ...ime });
        expect(mocks.mutateSessionUserTagAssignment).not.toHaveBeenCalled();
        expect(input).toHaveValue('ceshi');
        fireEvent.compositionEnd(input);
        fireEvent.keyDown(input, { key: 'Enter', isComposing: false, keyCode: 13 });
        await waitFor(() => expect(mocks.mutateSessionUserTagAssignment).toHaveBeenCalledWith(
            'session-1', { kind: 'add', name: 'ceshi' },
        ));
    });

    it.each([undefined, [] as string[]])('switches sessions with the same userTags reference %j without carrying a local selection', async userTags => {
        mocks.mutateSessionUserTagAssignment.mockImplementation(async (id: string) => ({
            action: 'updated', affectedSessionCount: 1, tags: [{ name: 'Beta', count: 2 }],
            session: { id, userTags: ['Beta'] },
        }));
        const callbacks = { onMutationStart: vi.fn(() => 1), onSessionUpdated: vi.fn(() => true) };
        const view = render(<SessionTagMenuItem session={{ id: 'session-a', userTags }} {...callbacks} />);
        fireEvent.click(screen.getByRole('button', { name: i18n.t('common:sessionTags.addTag') }));
        fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: /Beta/ }));
        await waitFor(() => expect(screen.getByRole('menuitemcheckbox', { name: /Beta/ })).toHaveAttribute('aria-checked', 'true'));

        view.rerender(<SessionTagMenuItem session={{ id: 'session-b', userTags }} {...callbacks} />);
        if (!screen.queryByRole('menuitemcheckbox', { name: /Beta/ })) {
            fireEvent.click(screen.getByRole('button', { name: i18n.t('common:sessionTags.addTag') }));
        }
        const beta = await screen.findByRole('menuitemcheckbox', { name: /Beta/ });
        expect(beta).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(beta);
        await waitFor(() => expect(mocks.mutateSessionUserTagAssignment).toHaveBeenLastCalledWith(
            'session-b', { kind: 'add', name: 'Beta' },
        ));
    });

    it('keeps a completed old-session mutation from replacing the new session selection', async () => {
        let finish!: (value: unknown) => void;
        mocks.mutateSessionUserTagAssignment.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        const callbacks = { onMutationStart: vi.fn(() => 1), onSessionUpdated: vi.fn(() => true) };
        const view = render(<SessionTagMenuItem session={{ id: 'session-a' }} {...callbacks} />);
        fireEvent.click(screen.getByRole('button', { name: i18n.t('common:sessionTags.addTag') }));
        fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: /Beta/ }));
        view.rerender(<SessionTagMenuItem session={{ id: 'session-b', userTags: ['Alpha'] }} {...callbacks} />);
        if (!screen.queryByRole('menuitemcheckbox', { name: /Alpha/ })) {
            fireEvent.click(screen.getByRole('button', { name: i18n.t('common:sessionTags.addTag') }));
        }
        expect(await screen.findByRole('menuitemcheckbox', { name: /Alpha/ })).toHaveAttribute('aria-checked', 'true');
        finish({ action: 'updated', affectedSessionCount: 1,
            tags: [{ name: 'Alpha', count: 2 }, { name: 'Beta', count: 2 }],
            session: { id: 'session-a', userTags: ['Beta'] } });
        await waitFor(() => expect(callbacks.onSessionUpdated).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'session-a' }), 1,
        ));
        expect(screen.getByRole('menuitemcheckbox', { name: /Alpha/ })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('menuitemcheckbox', { name: /Beta/ })).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByRole('menuitemcheckbox', { name: /Beta/ })).not.toBeDisabled();
    });

    it('does not show old-session recovery selection or errors in the new session', async () => {
        let reject!: (error: Error) => void;
        mocks.mutateSessionUserTagAssignment.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
        mocks.getSessions.mockResolvedValue([{ id: 'session-a', userTags: ['Beta'] }]);
        const callbacks = { onMutationStart: vi.fn(() => 1), onSessionUpdated: vi.fn(() => true) };
        const view = render(<SessionTagMenuItem session={{ id: 'session-a' }} {...callbacks} />);
        fireEvent.click(screen.getByRole('button', { name: i18n.t('common:sessionTags.addTag') }));
        fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: /Beta/ }));
        view.rerender(<SessionTagMenuItem session={{ id: 'session-b', userTags: ['Alpha'] }} {...callbacks} />);
        fireEvent.click(screen.getByRole('button', { name: i18n.t('common:sessionTags.addTag') }));
        expect(await screen.findByRole('menuitemcheckbox', { name: /Alpha/ })).toHaveAttribute('aria-checked', 'true');
        reject(new Error('old-session write failed'));
        await waitFor(() => expect(callbacks.onSessionUpdated).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'session-a' }), 1,
        ));
        expect(screen.getByRole('menuitemcheckbox', { name: /Alpha/ })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('menuitemcheckbox', { name: /Beta/ })).toHaveAttribute('aria-checked', 'false');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('does not let an older catalogue read overwrite a newly created tag', async () => {
        let finishRead!: (tags: unknown[]) => void;
        mocks.getSessionUserTags.mockReturnValueOnce(new Promise(resolve => { finishRead = resolve; }));
        mocks.mutateSessionUserTagAssignment.mockResolvedValue({ action: 'updated', affectedSessionCount: 1,
            tags: [{ name: 'Created', count: 1 }], session: { id: 'session-1', userTags: ['Created'] } });
        render(<SessionTagMenuItem session={{ id: 'session-1' }}
            onMutationStart={vi.fn(() => 1)} onSessionUpdated={vi.fn(() => true)} />);
        fireEvent.click(screen.getByRole('button', { name: i18n.t('common:sessionTags.addTag') }));
        const input = screen.getByRole('textbox', { name: i18n.t('common:sessionTags.searchTags') });
        fireEvent.change(input, { target: { value: 'Created' } });
        fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
        expect(await screen.findByRole('menuitemcheckbox', { name: /Created/ })).toHaveAttribute('aria-checked', 'true');
        await act(async () => { finishRead([{ name: 'Obsolete', count: 1 }]); });
        await waitFor(() => expect(input).toHaveValue(''));
        expect(screen.getByRole('menuitemcheckbox', { name: /Created/ })).toHaveAttribute('aria-checked', 'true');
        expect(screen.queryByRole('menuitemcheckbox', { name: /Obsolete/ })).not.toBeInTheDocument();
    });

    it('continues loading the shared catalogue when opening the manager from the picker', async () => {
        let finishRead!: (tags: unknown[]) => void;
        mocks.getSessionUserTags.mockReturnValueOnce(new Promise(resolve => { finishRead = resolve; }));
        render(<SessionTagMenuItem session={{ id: 'session-1' }}
            onMutationStart={vi.fn(() => 1)} onSessionUpdated={vi.fn(() => true)} />);
        fireEvent.click(screen.getByRole('button', { name: i18n.t('common:sessionTags.addTag') }));
        fireEvent.click(screen.getByRole('button', { name: i18n.t('common:sessionTags.manageTags') }));
        await act(async () => { finishRead([{ name: 'Alpha', count: 1 }]); });
        const manager = screen.getByRole('dialog', { name: i18n.t('common:sessionTags.manager.title') });
        expect(within(manager).getByText('Alpha')).toBeInTheDocument();
        fireEvent.click(within(manager).getByRole('button', { name: i18n.t('common:sessionTags.manager.rename', { name: 'Alpha' }) }));
        expect(within(manager).getByRole('textbox', { name: i18n.t('common:sessionTags.manager.renameInput', { name: 'Alpha' }) })).toHaveValue('Alpha');
    });

    it('settles loading when a mutation supersedes a read started by reopening the picker', async () => {
        let finishAssignment!: (value: unknown) => void;
        let finishRead!: (tags: unknown[]) => void;
        mocks.mutateSessionUserTagAssignment.mockReturnValueOnce(new Promise(resolve => { finishAssignment = resolve; }));
        const callbacks = { onMutationStart: vi.fn(() => 1), onSessionUpdated: vi.fn(() => true) };
        render(<SessionTagMenuItem session={{ id: 'session-1' }} {...callbacks} />);
        const addTag = screen.getByRole('button', { name: i18n.t('common:sessionTags.addTag') });
        fireEvent.click(addTag);
        fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: /Beta/ }));
        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape', keyCode: 27 });
        mocks.getSessionUserTags.mockReturnValueOnce(new Promise(resolve => { finishRead = resolve; }));
        fireEvent.click(addTag);
        expect(screen.queryByRole('menuitemcheckbox')).not.toBeInTheDocument();
        finishAssignment({ action: 'updated', affectedSessionCount: 1,
            tags: [{ name: 'Beta', count: 1 }], session: { id: 'session-1', userTags: ['Beta'] } });
        expect(await screen.findByRole('menuitemcheckbox', { name: /Beta/ })).toHaveAttribute('aria-checked', 'true');
        await act(async () => { finishRead([{ name: 'Alpha', count: 1 }]); });
        expect(screen.getByRole('menuitemcheckbox', { name: /Beta/ })).toHaveAttribute('aria-checked', 'true');
    });

    it('does not republish an old catalogue after a newer global rename was accepted', async () => {
        let finishAssignment!: (value: unknown) => void;
        mocks.mutateSessionUserTagAssignment.mockReturnValueOnce(new Promise(resolve => { finishAssignment = resolve; }));
        mocks.mutateGlobalSessionUserTag.mockResolvedValue({ action: 'updated', affectedSessionCount: 1,
            tags: [{ name: 'Gamma', count: 1 }, { name: 'Beta', count: 1 }], session: { id: 'session-1', userTags: ['Gamma', 'Beta'] } });
        let latest = 0;
        const updated = vi.fn((_session: unknown, sequence: number) => sequence === latest);
        render(<SessionTagMenuItem session={{ id: 'session-1', userTags: ['Alpha'] }}
            onMutationStart={() => ++latest} onSessionUpdated={updated} />);
        fireEvent.click(screen.getByRole('button', { name: i18n.t('common:sessionTags.addTag') }));
        fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: /Beta/ }));
        fireEvent.click(screen.getByRole('button', { name: i18n.t('common:sessionTags.manageTags') }));
        fireEvent.click(await screen.findByRole('button', { name: i18n.t('common:sessionTags.manager.rename', { name: 'Alpha' }) }));
        fireEvent.change(screen.getByRole('textbox', { name: i18n.t('common:sessionTags.manager.renameInput', { name: 'Alpha' }) }), { target: { value: 'Gamma' } });
        fireEvent.click(screen.getByRole('button', { name: i18n.t('common:sessionTags.manager.save') }));
        expect(await screen.findByText('Gamma')).toBeInTheDocument();
        finishAssignment({ action: 'updated', affectedSessionCount: 1,
            tags: [{ name: 'Alpha', count: 1 }, { name: 'Beta', count: 1 }], session: { id: 'session-1', userTags: ['Alpha', 'Beta'] } });
        await waitFor(() => expect(updated).toHaveBeenCalledWith(expect.objectContaining({ userTags: ['Alpha', 'Beta'] }), 1));
        expect(screen.getByText('Gamma')).toBeInTheDocument();
        expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    });

    it('keeps the checkbox picker open while adding and removing canonical Tags', async () => {
        const onSessionUpdated = vi.fn().mockReturnValue(true);
        mocks.mutateSessionUserTagAssignment
            .mockResolvedValueOnce({
                action: 'updated', affectedSessionCount: 1,
                tags: [{ name: 'Alpha', count: 2 }, { name: 'Beta', count: 2 }],
                session: { id: 'session-1', userTags: ['Alpha', 'Beta'] },
            })
            .mockResolvedValueOnce({
                action: 'updated', affectedSessionCount: 1,
                tags: [{ name: 'Beta', count: 2 }],
                session: { id: 'session-1', userTags: ['Beta'] },
            });
        render(
            <SessionTagMenuItem
                session={{ id: 'session-1', userTags: ['Alpha'] }}
                onMutationStart={vi.fn().mockReturnValue(1)}
                onSessionUpdated={onSessionUpdated}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: i18n.t('common:sessionTags.addTag') }));
        await screen.findByRole('menuitemcheckbox', { name: /Beta/ });
        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Beta/ }));
        await waitFor(() => expect(mocks.mutateSessionUserTagAssignment).toHaveBeenCalledWith(
            'session-1', { kind: 'add', name: 'Beta' },
        ));
        expect(screen.getByRole('menuitemcheckbox', { name: /Beta/ })).toHaveAttribute('aria-checked', 'true');

        fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Alpha/ }));
        await waitFor(() => expect(mocks.mutateSessionUserTagAssignment).toHaveBeenLastCalledWith(
            'session-1', { kind: 'remove', name: 'Alpha' },
        ));
        expect(onSessionUpdated).toHaveBeenCalledTimes(2);
        expect(screen.getByPlaceholderText(i18n.t('common:sessionTags.searchTags'))).toBeInTheDocument();
    });

    it('offers creation and disables additional assignments at the five-Tag cap', async () => {
        mocks.getSessionUserTags.mockResolvedValue([
            { name: 'A', count: 1 }, { name: 'B', count: 1 }, { name: 'C', count: 1 },
            { name: 'D', count: 1 }, { name: 'E', count: 1 }, { name: 'Free', count: 1 },
        ]);
        render(
            <SessionTagMenuItem
                session={{ id: 'session-1', userTags: ['A', 'B', 'C', 'D', 'E'] }}
                onMutationStart={vi.fn().mockReturnValue(1)}
                onSessionUpdated={vi.fn().mockReturnValue(true)}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: i18n.t('common:sessionTags.addTag') }));
        const input = await screen.findByPlaceholderText(i18n.t('common:sessionTags.searchTags'));
        await screen.findByRole('menuitemcheckbox', { name: /Free/ });
        expect(screen.getByRole('menuitemcheckbox', { name: /Free/ })).toBeDisabled();
        expect(screen.getByRole('menuitemcheckbox', { name: /A/ })).not.toBeDisabled();

        fireEvent.change(input, { target: { value: 'New Tag' } });
        expect(screen.getByRole('menuitem', { name: /创建「New Tag」/ })).toBeDisabled();
        expect(screen.getByText(i18n.t('common:sessionTags.limitHint', { count: 5 }))).toBeInTheDocument();
    });

    it('opens global management and renames every assignment through one batch mutation', async () => {
        const onGlobalTagChange = vi.fn();
        mocks.mutateGlobalSessionUserTag.mockResolvedValue({
            action: 'updated',
            affectedSessionCount: 2,
            tags: [{ name: 'Gamma', count: 2 }, { name: 'Beta', count: 1 }],
            session: { id: 'session-1', userTags: ['Gamma'] },
        });
        render(
            <SessionTagMenuItem
                session={{ id: 'session-1', userTags: ['Alpha'] }}
                onMutationStart={vi.fn().mockReturnValue(1)}
                onSessionUpdated={vi.fn().mockReturnValue(true)}
                onGlobalTagChange={onGlobalTagChange}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: i18n.t('common:sessionTags.addTag') }));
        await screen.findByRole('button', { name: i18n.t('common:sessionTags.manageTags') });
        fireEvent.click(screen.getByRole('button', { name: i18n.t('common:sessionTags.manageTags') }));
        fireEvent.click(await screen.findByRole('button', { name: i18n.t('common:sessionTags.manager.rename', { name: 'Alpha' }) }));
        const renameInput = screen.getByRole('textbox', { name: i18n.t('common:sessionTags.manager.renameInput', { name: 'Alpha' }) });
        fireEvent.change(renameInput, { target: { value: 'Gamma' } });
        fireEvent.click(screen.getByRole('button', { name: i18n.t('common:sessionTags.manager.save') }));

        await waitFor(() => expect(mocks.mutateGlobalSessionUserTag).toHaveBeenCalledWith({
            kind: 'rename', name: 'Alpha', newName: 'Gamma', merge: false,
        }, 'session-1'));
        expect(onGlobalTagChange).toHaveBeenCalledWith({ kind: 'rename', name: 'Alpha', newName: 'Gamma' });
    });

    it('normalizes the candidate query so decomposed Unicode finds an existing Tag', async () => {
        mocks.getSessionUserTags.mockResolvedValue([{ name: 'Café', count: 1 }]);
        render(
            <SessionTagMenuItem
                session={{ id: 'session-1', userTags: [] }}
                onMutationStart={vi.fn().mockReturnValue(1)}
                onSessionUpdated={vi.fn().mockReturnValue(true)}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: i18n.t('common:sessionTags.addTag') }));
        const input = await screen.findByPlaceholderText(i18n.t('common:sessionTags.searchTags'));
        fireEvent.change(input, { target: { value: 'Cafe\u0301' } });

        expect(screen.getByRole('menuitemcheckbox', { name: /Café/ })).toBeInTheDocument();
        expect(screen.queryByText(/创建「/)).not.toBeInTheDocument();
    });

    it('keeps the mutation error while reconciling the target Session from fresh authority', async () => {
        const onSessionUpdated = vi.fn().mockReturnValue(true);
        mocks.mutateSessionUserTagAssignment.mockRejectedValue(
            new SessionUserTagApiError('limit-reached', 'limit', 409),
        );
        mocks.getSessions.mockResolvedValue([{
            id: 'session-1',
            agentDir: '/workspace',
            title: 'Session',
            createdAt: '2026-09-02T00:00:00.000Z',
            lastActiveAt: '2026-09-02T00:00:00.000Z',
            userTags: ['Alpha'],
        }]);
        render(
            <SessionTagMenuItem
                session={{ id: 'session-1', userTags: ['Alpha'] }}
                onMutationStart={vi.fn().mockReturnValue(8)}
                onSessionUpdated={onSessionUpdated}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: i18n.t('common:sessionTags.addTag') }));
        fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: /Beta/ }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            i18n.t('common:sessionTags.errors.limitReached'),
        );
        expect(onSessionUpdated).toHaveBeenCalledWith(expect.objectContaining({ userTags: ['Alpha'] }), 8);
    });

    it('focuses and traps the manager dialog, then restores the menu anchor on Escape', async () => {
        render(
            <SessionTagMenuItem
                session={{ id: 'session-1', userTags: ['Alpha'] }}
                onMutationStart={vi.fn().mockReturnValue(1)}
                onSessionUpdated={vi.fn().mockReturnValue(true)}
            />,
        );
        const anchor = screen.getByRole('button', { name: i18n.t('common:sessionTags.addTag') });
        fireEvent.click(anchor);
        fireEvent.click(await screen.findByRole('button', { name: i18n.t('common:sessionTags.manageTags') }));
        const dialog = await screen.findByRole('dialog');
        await waitFor(() => expect(within(dialog).getByRole('button', { name: i18n.t('common:sessionTags.close') })).toHaveFocus());

        fireEvent.keyDown(document, { key: 'Escape' });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(anchor).toHaveFocus();
    });
});
