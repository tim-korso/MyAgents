import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TableActions from './TableActions';
import { copyRichText } from '@/utils/clipboard';

vi.mock('@/utils/clipboard', () => ({ copyRichText: vi.fn() }));
const snapshot = { html: '<table><tr><td>A</td></tr></table>', text: 'A', rows: [['A']] };
const copyButton = () => screen.getByRole('button', { name: '复制表格' });
const copiedButton = () => screen.getByRole('button', { name: '已复制表格' });
const clickCopy = async () => { await act(async () => { fireEvent.click(copyButton()); }); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(copyRichText).mockReset().mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); });

describe('TableActions copy feedback', () => {
  it('shows a check only after success, resets after 1500ms, and restarts on repeated copy', async () => {
    render(<StrictMode><TableActions getSnapshot={() => snapshot} /></StrictMode>);
    await clickCopy();
    expect(copiedButton().querySelector('.lucide-check')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1000); });
    await act(async () => { fireEvent.click(copiedButton()); });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(copiedButton()).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(500); });
    expect(copyButton().querySelector('.lucide-copy')).toBeInTheDocument();
    expect(copyRichText).toHaveBeenCalledTimes(2);
  });

  it('keeps pending writes busy and does not report success on failure', async () => {
    let rejectWrite!: (error: Error) => void;
    vi.mocked(copyRichText).mockImplementationOnce(() => new Promise((_, reject) => { rejectWrite = reject; }));
    render(<TableActions getSnapshot={() => Promise.resolve(snapshot)} />);
    await clickCopy();
    expect(copyButton()).toHaveAttribute('aria-disabled', 'true');
    expect(copyButton().querySelector('.lucide-loader-circle')).toBeInTheDocument();
    await clickCopy();
    expect(copyRichText).toHaveBeenCalledOnce();
    await act(async () => { rejectWrite(new Error('denied')); });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '已复制表格' })).not.toBeInTheDocument();
    await clickCopy();
    expect(copiedButton()).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears stale success when a subsequent copy fails', async () => {
    render(<TableActions getSnapshot={() => snapshot} />);
    await clickCopy();
    vi.mocked(copyRichText).mockRejectedValueOnce(new Error('denied'));
    await act(async () => { fireEvent.click(copiedButton()); });
    expect(copyButton().querySelector('.lucide-copy')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('cleans the feedback timer on unmount and ignores a late clipboard completion', async () => {
    const first = render(<TableActions getSnapshot={() => snapshot} />);
    await clickCopy();
    first.unmount();
    expect(vi.getTimerCount()).toBe(0);
    let finishWrite!: () => void;
    vi.mocked(copyRichText).mockImplementationOnce(() => new Promise(resolve => { finishWrite = resolve; }));
    const second = render(<TableActions getSnapshot={() => Promise.resolve(snapshot)} />);
    await clickCopy();
    second.unmount();
    await act(async () => { finishWrite(); });
    expect(vi.getTimerCount()).toBe(0);
  });
});
