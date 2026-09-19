import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ConflictComparison, { type ConflictSnapshot } from './ConflictComparison';

const snapshot: ConflictSnapshot = { local: 'first local\nsecond local\n', disk: 'first disk\nsecond disk\n', path: 'note.md', revision: 1, generation: 1 };

describe('stacked source line choices', () => {
  it('allows opposite choices within one change block, requires result preview, and submits exact source', async () => {
    const apply = vi.fn().mockResolvedValue(true), close = vi.fn();
    render(<ConflictComparison snapshot={snapshot} stale={false} onApply={apply} onClose={close} onRefresh={async () => {}} onCopy={async () => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: '采用本地草稿第 1 行' }));
    fireEvent.click(screen.getByRole('button', { name: '采用磁盘版本第 2 行' }));
    expect(screen.getByRole('button', { name: '应用并保存' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '检查组合结果' }));
    expect(screen.getByRole('textbox', { name: '检查组合结果' })).toHaveValue('first local\nsecond disk\n');
    fireEvent.click(screen.getByRole('button', { name: '应用并保存' }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith('first local\nsecond disk\n', snapshot, false));
    expect(close).toHaveBeenCalled();
  });

  it('keeps stale choices visible, blocks commit and clears them for a refreshed snapshot', async () => {
    const props = { snapshot, stale: false, onApply: vi.fn(), onClose: vi.fn(), onRefresh: vi.fn(), onCopy: vi.fn() };
    const { rerender } = render(<ConflictComparison {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: '采用本地草稿第 1 行' }));
    rerender(<ConflictComparison {...props} stale />);
    expect(screen.getByRole('button', { name: '采用本地草稿第 1 行' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '采用本地草稿第 1 行' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '应用并保存' })).toBeDisabled();
    rerender(<ConflictComparison {...props} snapshot={{ ...snapshot, revision: 2, local: 'new first\nsecond local\n' }} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '采用本地草稿第 1 行' })).toHaveAttribute('aria-pressed', 'false'));
  });

  it('keeps a large comparison DOM bounded', async () => {
    render(<ConflictComparison snapshot={{ ...snapshot, local: 'L\n'.repeat(10000), disk: 'D\n'.repeat(10000) }} stale={false} onApply={vi.fn()} onClose={vi.fn()} onRefresh={vi.fn()} onCopy={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    await within(dialog).findByRole('button', { name: '采用本地草稿第 1 行' }, { timeout: 3000 });
    expect(within(dialog).getAllByRole('button').length).toBeLessThan(120);
  });
});
