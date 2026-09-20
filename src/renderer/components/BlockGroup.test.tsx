// Regression tests for compact process-group folding.
//
// A group of 4+ process blocks auto-folds the middle ones behind a 「展开全部」
// bar (and UNMOUNTS them — "collapse = unmount"). If the user has deliberately
// expanded a row, the fold must NOT kick in for that turn — otherwise it would
// unmount the row they opened and silently drop its expanded state. Expanding
// any row pins the group open (same effect as clicking 「展开全部」).
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';

import BlockGroup from './BlockGroup';
import type { ContentBlock } from '@/types/chat';

afterEach(() => cleanup());

function thinking(i: number): ContentBlock {
  return { type: 'thinking', thinking: `REASON_${i}`, isComplete: true, thinkingDurationMs: 1000 } as ContentBlock;
}

function task(i: number): ContentBlock {
  return {
    type: 'tool_use',
    tool: {
      id: `task-${i}`,
      name: 'Task',
      input: {},
      inputJson: '{}',
      result: '{}',
    },
  } as ContentBlock;
}

function read(i: number): ContentBlock {
  return {
    type: 'tool_use',
    tool: {
      id: `read-${i}`,
      name: 'Read',
      input: {},
      inputJson: '{"file_path":"/tmp/f' + i + '"}',
      result: 'line',
      isLoading: false,
    },
  } as ContentBlock;
}

function processRowCount(container: HTMLElement): number {
  return container.querySelectorAll('button[aria-expanded]').length;
}

describe('BlockGroup compact folding', () => {
  it('shows all 3 blocks without exposing an inactive fold control', () => {
    const blocks = Array.from({ length: 3 }, (_, i) => thinking(i));
    const { container } = render(<BlockGroup blocks={blocks} isStreaming={false} />);

    expect(processRowCount(container)).toBe(3);
    expect(screen.queryByRole('button', { name: /展开全部/ })).toBeNull();

    fireEvent.click(container.querySelectorAll('button[aria-expanded]')[1]);
    expect(screen.getByText(/REASON_1/)).toBeTruthy();
  });

  it('folds 4 blocks into first + more + latest and expands all on demand', () => {
    const blocks = Array.from({ length: 4 }, (_, i) => task(i));
    const { container } = render(<BlockGroup blocks={blocks} isStreaming={false} />);

    expect(processRowCount(container)).toBe(2);
    expect(container.querySelector('[data-tool-id="task-0"]')).toBeTruthy();
    expect(container.querySelector('[data-tool-id="task-1"]')).toBeNull();
    expect(container.querySelector('[data-tool-id="task-2"]')).toBeNull();
    expect(container.querySelector('[data-tool-id="task-3"]')).toBeTruthy();
    expect(screen.getByText('+2')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /展开全部/ }));

    expect(processRowCount(container)).toBe(4);
    expect(container.querySelector('[data-tool-id="task-1"]')).toBeTruthy();
    expect(container.querySelector('[data-tool-id="task-2"]')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /展开全部/ })).toBeNull();
  });

  it('switches from 3 visible rows to the compact layout when streaming appends a fourth block', () => {
    const firstThree = Array.from({ length: 3 }, (_, i) => task(i));
    const { container, rerender } = render(<BlockGroup blocks={firstThree} isStreaming />);

    expect(processRowCount(container)).toBe(3);

    rerender(<BlockGroup blocks={[...firstThree, task(3)]} isStreaming />);

    expect(processRowCount(container)).toBe(2);
    expect(container.querySelector('[data-tool-id="task-0"]')).toBeTruthy();
    expect(container.querySelector('[data-tool-id="task-3"]')).toBeTruthy();
    expect(screen.getByText('+2')).toBeTruthy();
  });

  it('suppresses the fold once a row is expanded', () => {
    const blocks = Array.from({ length: 4 }, (_, i) => thinking(i));
    render(<BlockGroup blocks={blocks} isStreaming={false} />);

    // Folded: the 「展开全部」 bar's grid is open (1fr). Its nearest `.grid`
    // ancestor is the styled fold-bar container (the middle-zone grid is not
    // rendered while folded, so this is unambiguous).
    const foldBtn = screen.getByText('展开全部');
    const grid = foldBtn.closest('.grid') as HTMLElement;
    expect(grid.style.gridTemplateRows).toBe('1fr');

    // Expand the first (always-visible head) row.
    fireEvent.click(screen.getAllByRole('button')[0]);

    // Fold is now suppressed (grid collapsed) and the opened row's reasoning shows.
    expect(grid.style.gridTemplateRows).toBe('0fr');
    expect(screen.getByText(/REASON_0/)).toBeTruthy();
  });
});

// A turn that inspects many files used to render one near-identical row per
// file, which is most of the visual noise in a long turn. Consecutive read-only
// lookups now collapse into a single summary row that expands to the originals.
describe('BlockGroup merged inspections', () => {
  it('renders a run of reads as one row instead of one row per file', () => {
    const blocks = Array.from({ length: 5 }, (_, i) => read(i));
    const { container } = render(<BlockGroup blocks={blocks} isStreaming={false} />);

    // Five reads collapse to a single merged row, so only one toggle exists.
    expect(processRowCount(container)).toBe(1);
    expect(container.querySelector('[data-merged-inspection]')).toBeTruthy();
    // The individual reads are not mounted while collapsed.
    expect(container.querySelector('[data-tool-id="read-0"]')).toBeNull();
  });

  it('expands the merged row to the original tool bodies', () => {
    const blocks = Array.from({ length: 3 }, (_, i) => read(i));
    const { container } = render(<BlockGroup blocks={blocks} isStreaming={false} />);

    fireEvent.click(screen.getAllByRole('button')[0]);

    expect(container.querySelectorAll('[data-merged-inspection-member]')).toHaveLength(3);
  });

  it('keeps a single read as an ordinary row with its own tool anchor', () => {
    const { container } = render(<BlockGroup blocks={[read(0)]} isStreaming={false} />);

    expect(container.querySelector('[data-merged-inspection]')).toBeNull();
    // A lone read stays a plain ProcessRow: one toggle, and its collapsed body
    // is not mounted. (data-tool-id is only set for Task tools, so count rows.)
    expect(processRowCount(container)).toBe(1);
  });

  it('does not merge reads separated by a write', () => {
    const write: ContentBlock = {
      type: 'tool_use',
      tool: { id: 'write-0', name: 'Write', input: {}, inputJson: '{}', result: 'ok' },
    } as ContentBlock;
    const { container } = render(
      <BlockGroup blocks={[read(0), read(1), write, read(2), read(3)]} isStreaming={false} />,
    );

    // Two merged runs plus the write row = 3 rows total.
    expect(container.querySelectorAll('[data-merged-inspection]')).toHaveLength(2);
    expect(processRowCount(container)).toBe(3);
  });
});
