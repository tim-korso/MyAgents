import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PermissionPrompt } from './PermissionPrompt';
import { i18n } from '@/i18n';

it('focuses decline and hides lasting approval for a constrained request', async () => {
    await i18n.changeLanguage('en-US');
    const onDecision = vi.fn();
    render(<PermissionPrompt request={{ requestId: 'restricted', toolName: 'Bash', input: '{}',
        defaultToNo: true, suppressAlwaysAllowRule: true }} onDecision={onDecision} />);
    const deny = screen.getByRole('button', { name: String(i18n.t('chat:shell.permissionPrompt.deny')) });
    expect(deny).toHaveFocus();
    expect(screen.queryByRole('button', { name: String(i18n.t('chat:shell.permissionPrompt.alwaysAllow')) })).toBeNull();
    expect(onDecision).not.toHaveBeenCalled();
    fireEvent.click(deny);
    expect(onDecision).toHaveBeenCalledWith('restricted', 'deny');
});

it('keeps the existing approval choices for ordinary requests', async () => {
    await i18n.changeLanguage('en-US');
    const onDecision = vi.fn();
    render(<PermissionPrompt request={{ requestId: 'normal', toolName: 'WebFetch', input: '{}' }} onDecision={onDecision} />);
    fireEvent.click(screen.getByRole('button', { name: String(i18n.t('chat:shell.permissionPrompt.alwaysAllow')) }));
    expect(onDecision).toHaveBeenCalledWith('normal', 'always_allow');
});
