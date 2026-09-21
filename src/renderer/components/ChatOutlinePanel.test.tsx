// The outline is the answer to "which turn was that?", so its two failure
// modes matter: listing the wrong number of turns, and losing the highlight
// that tells the user where they currently are.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import ChatOutlinePanel from './ChatOutlinePanel';
import type { ChatOutlineEntry } from '@/utils/chatOutline';

afterEach(() => cleanup());

function entry(n: number, preview = `question ${n}`): ChatOutlineEntry {
  return { id: `u${n}`, turnIndex: n, preview };
}

describe('ChatOutlinePanel', () => {
  it('lists every turn with its index', () => {
    render(
      <ChatOutlinePanel
        entries={[entry(1, 'first'), entry(2, 'second')]}
        activeIndex={0}
        onJump={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('first')).toBeTruthy();
    expect(screen.getByText('second')).toBeTruthy();
  });

  it('jumps to the entry the user picks', () => {
    const onJump = vi.fn();
    render(
      <ChatOutlinePanel
        entries={[entry(1), entry(2)]}
        activeIndex={-1}
        onJump={onJump}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('question 2'));
    expect(onJump).toHaveBeenCalledWith(expect.objectContaining({ id: 'u2' }));
  });

  it('marks the turn currently being read', () => {
    render(
      <ChatOutlinePanel
        entries={[entry(1), entry(2), entry(3)]}
        activeIndex={1}
        onJump={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const current = screen.getByText('question 2').closest('button');
    expect(current?.getAttribute('aria-current')).toBe('true');
    expect(screen.getByText('question 1').closest('button')?.getAttribute('aria-current')).toBeNull();
  });

  it('explains itself instead of rendering an empty box', () => {
    render(<ChatOutlinePanel entries={[]} activeIndex={-1} onJump={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/暂无提问记录|No turns yet/)).toBeTruthy();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<ChatOutlinePanel entries={[entry(1)]} activeIndex={0} onJump={vi.fn()} onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes via its close button', () => {
    const onClose = vi.fn();
    render(<ChatOutlinePanel entries={[entry(1)]} activeIndex={0} onJump={vi.fn()} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /关闭|Close/ }));
    expect(onClose).toHaveBeenCalled();
  });
});
