import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { i18n } from '@/i18n';
import { AskUserQuestionPrompt, type AskUserQuestionRequest } from './AskUserQuestionPrompt';

const question = (requestId = 'q1'): AskUserQuestionRequest => ({
  requestId,
  questions: [
    {
      question: '继续吗？',
      header: '选择',
      options: [{ label: '继续', description: '继续工作' }],
      multiSelect: false,
    },
  ],
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((r, j) => {
    resolve = r;
    reject = j;
  });
  // Old implementations ignored returned promises. Keep the expected red about
  // visible behavior instead of an unrelated unhandled-rejection report.
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

describe('AskUserQuestion submission lifecycle', () => {
  it.each(['submit', 'cancel'] as const)(
    'retains answers and enables retry after failed %s',
    async (action) => {
      await i18n.changeLanguage('zh-CN');
      const receipt = deferred();
      const respond = vi.fn().mockReturnValueOnce(receipt.promise).mockResolvedValue(undefined);
      render(<AskUserQuestionPrompt request={question()} onSubmit={respond} onCancel={respond} />);
      fireEvent.click(screen.getByRole('button', { name: /继续工作/ }));
      const submit = screen.getByRole('button', { name: '提交' });
      fireEvent.click(action === 'submit' ? submit : screen.getByRole('button', { name: '取消' }));
      expect(submit).toBeDisabled();
      await act(async () => {
        receipt.reject(new Error('offline'));
      });
      expect(await screen.findByRole('alert')).toHaveTextContent('提交失败，请重试');
      expect(submit).toBeEnabled();
      fireEvent.click(submit);
      await waitFor(() => expect(respond).toHaveBeenLastCalledWith('q1', { '0': '继续' }));
    },
  );

  it('gives a replacement request a fresh form while the old receipt settles', async () => {
    await i18n.changeLanguage('zh-CN');
    const receipt = deferred();
    const respond = vi.fn(() => receipt.promise);
    const view = render(
      <AskUserQuestionPrompt request={question('old')} onSubmit={respond} onCancel={respond} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /继续工作/ }));
    fireEvent.click(screen.getByRole('button', { name: '提交' }));
    view.rerender(<AskUserQuestionPrompt request={question('new')} onSubmit={respond} onCancel={respond} />);
    expect(screen.getByRole('button', { name: /继续工作/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: '提交' })).toBeDisabled();
    await act(async () => {
      receipt.reject(new Error('old failure'));
    });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /继续工作/ }));
    expect(screen.getByRole('button', { name: '提交' })).toBeEnabled();
  });
});
