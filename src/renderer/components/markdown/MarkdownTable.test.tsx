import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Markdown from '../Markdown';
import userEvent from '@testing-library/user-event';
import { copyRichText } from '@/utils/clipboard';
import { downloadBlob } from '@/utils/markdownExport';
vi.mock('@/utils/clipboard', () => ({ copyRichText: vi.fn() }));
vi.mock('@/utils/markdownExport', () => ({ downloadBlob: vi.fn(), localDateStr: () => '2026-09-13' }));
beforeEach(() => { vi.mocked(copyRichText).mockReset().mockResolvedValue(undefined); vi.mocked(downloadBlob).mockReset().mockResolvedValue('saved'); });
describe('Markdown table actions', () => {
  it('copies only the chosen table and exports an xlsx', async () => {
    render(<Markdown raw>{'Before\n\n| First |\n| --- |\n| **one** |\n\nBetween\n\n| Second |\n| --- |\n| two |\n\nAfter'}</Markdown>);
    fireEvent.click(screen.getAllByRole('button', { name: '复制表格' })[1]);
    await waitFor(() => expect(copyRichText).toHaveBeenCalledOnce());
    expect(copyRichText).toHaveBeenCalledWith(expect.stringContaining('<td'), 'Second\r\ntwo');
    expect(vi.mocked(copyRichText).mock.calls[0][0]).not.toMatch(/First|Before|Between|After|button/);
    fireEvent.click(screen.getAllByRole('button', { name: '下载 Excel' })[0]);
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledOnce());
    expect(downloadBlob).toHaveBeenCalledWith('2026-09-13-table.xlsx', expect.objectContaining({ type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  });
  it('keeps button activation keys out of the enclosing editor', async () => {
    const user = userEvent.setup();
    const editorKey = vi.fn();
    render(<div onKeyDown={editorKey}><Markdown raw>{'| A |\n| --- |\n| B |'}</Markdown></div>);
    await user.tab();
    editorKey.mockClear();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(copyRichText).toHaveBeenCalledOnce());
    expect(editorKey).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '已复制表格' })).toHaveFocus();
  });
  it('shows failure and permits retry without pretending the copy succeeded', async () => {
    vi.mocked(copyRichText).mockRejectedValueOnce(new Error('denied'));
    render(<Markdown raw>{'| A |\n| --- |\n| B |'}</Markdown>);
    fireEvent.click(screen.getByRole('button', { name: '复制表格' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('表格操作失败');
    fireEvent.click(screen.getByRole('button', { name: '复制表格' }));
    await waitFor(() => expect(copyRichText).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
