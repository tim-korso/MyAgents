import { useEffect } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/Toast';
import { i18n } from '@/i18n';
import type { TranscriptSaveStatus } from '../../shared/sessionTranscript';
import { useTranscriptSaveToast } from './useTranscriptSaveToast';

const fault: TranscriptSaveStatus = {
    sessionId: 'chat', instanceId: 'sidecar', generation: 'g1',
    state: 'retrying', incidentId: 'one-fault', reason: 'io', liveRevision: 5, durableRevision: 2,
};

function Consumer({ status, title }: { status: TranscriptSaveStatus; title?: string }) {
    const show = useTranscriptSaveToast();
    useEffect(() => show(status, title), [show, status, title]);
    return null;
}

describe('save fault toast presentation', () => {
    beforeEach(async () => { await i18n.changeLanguage('zh-CN'); vi.useFakeTimers(); });
    afterEach(() => vi.useRealTimers());

    it('preserves the draft and focus, lasts five seconds and does not repeat on remount', () => {
        function View({ active, status }: { active: boolean; status: TranscriptSaveStatus }) {
            return <ToastProvider>
                <input aria-label="Draft" defaultValue="继续提问" />
                <button>Send</button>
                {active && <Consumer status={status} />}
            </ToastProvider>;
        }
        const view = render(<View active={false} status={fault} />);
        const draft = screen.getByLabelText('Draft');
        draft.focus();
        view.rerender(<View active status={fault} />);
        expect(screen.getByRole('status')).toHaveTextContent('对话记录暂时无法保存，不影响继续使用；未保存内容可能在关闭后丢失。');
        expect(draft).toHaveFocus();
        expect(draft).toHaveValue('继续提问');
        expect(screen.getByRole('button', { name: 'Send' })).not.toBeDisabled();
        expect(screen.queryByRole('dialog')).toBeNull();
        act(() => { vi.advanceTimersByTime(4999); });
        expect(screen.getByRole('status')).toBeInTheDocument();
        act(() => { vi.advanceTimersByTime(1); });
        expect(screen.queryByRole('status')).toBeNull();
        view.rerender(<View active={false} status={fault} />);
        view.rerender(<View active status={fault} />);
        expect(screen.queryByRole('status')).toBeNull();
        view.rerender(<View active status={{ ...fault, state: 'healthy', durableRevision: 5 }} />);
        expect(screen.getByRole('status')).toHaveTextContent('对话记录保存已恢复。');
        act(() => { vi.advanceTimersByTime(3000); });
        expect(screen.queryByRole('status')).toBeNull();
        expect(draft).toHaveFocus();
    });

    it('labels a background session and has an accessible dismiss action in English', async () => {
        await i18n.changeLanguage('en-US');
        render(<ToastProvider><Consumer status={fault} title="Research chat" /></ToastProvider>);
        expect(screen.getByRole('status')).toHaveTextContent('Research chat');
        expect(screen.getByRole('status')).toHaveTextContent('You can keep chatting');
        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(screen.queryByRole('status')).toBeNull();
    });
});
