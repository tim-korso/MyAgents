// Measures what the merge actually costs on the render path during a stream:
// every frame re-derives the merged items and re-renders the rows. Asserts the
// whole cycle stays far inside the 16.7ms 60fps budget.
import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';

import BlockGroup from '@/components/BlockGroup';
import type { ContentBlock } from '@/types/chat';

function readonlyTool(id: string, i: number): ContentBlock {
  return {
    type: 'tool_use',
    tool: {
      id,
      name: 'Read',
      input: {},
      streamIndex: i,
      inputJson: '{"file_path":"/tmp/x"}',
      result: 'file contents '.repeat(20),
      isLoading: false,
    },
  };
}

describe('BlockGroup render cost', () => {
  it('renders a 40-read turn inside the frame budget', () => {
    const blocks = Array.from({ length: 40 }, (_, i) => readonlyTool(`r${i}`, i));
    const { rerender, unmount } = render(<BlockGroup blocks={blocks} isStreaming />);
    // Warm the JIT and React's internals before measuring.
    for (let i = 0; i < 5; i++) rerender(<BlockGroup blocks={blocks} isStreaming />);

    const ITER = 30;
    const t0 = performance.now();
    for (let i = 0; i < ITER; i++) rerender(<BlockGroup blocks={blocks} isStreaming />);
    const perFrame = (performance.now() - t0) / ITER;
    unmount();

    console.log(`  BlockGroup rerender (40 merged reads): ${perFrame.toFixed(3)} ms`);
    expect(perFrame).toBeLessThan(16.7);
  });

  it('does not degrade when streaming appends one more read each frame', () => {
    const base = Array.from({ length: 30 }, (_, i) => readonlyTool(`r${i}`, i));
    const { rerender, unmount } = render(<BlockGroup blocks={base} isStreaming />);

    const t0 = performance.now();
    for (let i = 30; i < 60; i++) {
      rerender(<BlockGroup blocks={[...base, readonlyTool(`r${i}`, i)]} isStreaming />);
    }
    const perFrame = (performance.now() - t0) / 30;
    unmount();

    console.log(`  BlockGroup streaming append frame: ${perFrame.toFixed(3)} ms`);
    expect(perFrame).toBeLessThan(16.7);
  });
});

// A row that remounts on every frame would drop the user's expanded state and
// thrash the DOM. Appending a read must update the existing merged row in
// place — same DOM node, same toggle state.
describe('BlockGroup merge identity', () => {
  it('keeps the same merged row node when another read streams in', () => {
    const base = [readonlyTool('r0', 0), readonlyTool('r1', 1), readonlyTool('r2', 2)];
    const { container, rerender } = render(<BlockGroup blocks={base} isStreaming />);

    const before = container.querySelector('[data-merged-inspection]');
    expect(before).toBeTruthy();

    rerender(<BlockGroup blocks={[...base, readonlyTool('r3', 3)]} isStreaming />);

    const after = container.querySelector('[data-merged-inspection]');
    // Same element identity: React updated in place rather than replacing it.
    expect(after).toBe(before);
  });

  it('keeps the merged row expanded while more reads stream in', () => {
    const base = [readonlyTool('r0', 0), readonlyTool('r1', 1)];
    const { container, rerender } = render(<BlockGroup blocks={base} isStreaming />);

    fireEvent.click(container.querySelector('[data-merged-inspection] button')!);
    expect(container.querySelectorAll('[data-merged-inspection-member]')).toHaveLength(2);

    rerender(<BlockGroup blocks={[...base, readonlyTool('r2', 2)]} isStreaming />);

    // Still expanded, and the new member is present.
    expect(container.querySelectorAll('[data-merged-inspection-member]')).toHaveLength(3);
  });
});
