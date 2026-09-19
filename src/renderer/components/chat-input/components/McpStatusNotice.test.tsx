import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/i18n';
import { ToastProvider } from '@/components/Toast';
import { McpStatusNotice } from './McpStatusNotice';
import type { McpEffectiveServerSnapshot } from '../../../../shared/mcpEffectiveState';

const failed: McpEffectiveServerSnapshot = {
  id: 'playwright', desired: true, state: 'failed', toolCount: 0,
  errorCode: 'MCP_CONNECTION_TIMEOUT', attemptGeneration: 1, updatedAt: 1,
};
function notice(props: Partial<React.ComponentProps<typeof McpStatusNotice>> = {}) {
  return <ToastProvider><McpStatusNotice server={failed} {...props} /></ToastProvider>;
}

describe('MCP status and explicit retry', () => {
  beforeEach(async () => { await i18n.changeLanguage('zh-CN'); });

  it('shows a useful reason and falls back for old unknown error codes', () => {
    const view = render(notice());
    expect(screen.getByText('工具连接超时')).toBeInTheDocument();
    view.rerender(notice({ server: { ...failed, errorCode: 'upstream-new-code' } }));
    expect(screen.getByText('当前不可用')).toBeInTheDocument();
    expect(screen.queryByText('upstream-new-code')).not.toBeInTheDocument();
  });

  it('distinguishes stale observation, authorization and ready state', () => {
    const retry = vi.fn();
    const view = render(notice({ stale: true }));
    expect(screen.getByText('状态待确认')).toBeInTheDocument();
    view.rerender(notice({ server: { ...failed, state: 'needs_auth' }, onRetry: retry }));
    expect(screen.getByText('需要登录授权')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    view.rerender(notice({ server: { ...failed, state: 'ready' } }));
    expect(screen.queryByText('工具连接超时')).not.toBeInTheDocument();
  });

  it('blocks busy sessions, deduplicates clicks and explains backend refusal', async () => {
    let resolve!: (result: { success: boolean; errorCode: 'session_busy' }) => void;
    const retry = vi.fn(() => new Promise<{ success: boolean; errorCode: 'session_busy' }>(done => { resolve = done; }));
    const view = render(notice({ busy: true, onRetry: retry }));
    expect(screen.getByRole('button', { name: '重试连接' })).toBeDisabled();
    view.rerender(notice({ onRetry: retry }));
    const button = screen.getByRole('button', { name: '重试连接' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(retry).toHaveBeenCalledExactlyOnceWith('playwright');
    expect(button).toBeDisabled();
    await act(async () => { resolve({ success: false, errorCode: 'session_busy' }); });
    expect(screen.getByText('请等待当前会话任务完成后重试')).toBeInTheDocument();
    expect(button).toBeEnabled();
  });

  it('preserves a non-2xx Tab API error code without showing raw error text', async () => {
    const retry = vi.fn().mockRejectedValue(Object.assign(new Error('HTTP 409 /private/SECRET'), { errorCode: 'session_busy' }));
    render(notice({ onRetry: retry }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重试连接' })); });
    expect(screen.getByText('请等待当前会话任务完成后重试')).toBeInTheDocument();
    expect(screen.queryByText(/SECRET/)).not.toBeInTheDocument();
  });
});
