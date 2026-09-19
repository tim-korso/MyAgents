import { act, render, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { resolveHorizontalGestureOwnership } from '@/hooks/tabSwipeGestureOwnership';
import MarkdownEditor, { type MarkdownEditorHandle } from './MarkdownEditor';
vi.mock('@/hooks/useTauriFileDrop', () => ({ useTauriFileDrop: () => ({ registerZone: vi.fn(), unregisterZone: vi.fn() }) }));
vi.mock('@/hooks/useWorkspaceFileService', () => ({ useWorkspaceFileService: () => ({ isAvailable: false }) }));
vi.mock('@/context/BrowserPanelContext', () => ({ useOpenWebLink: () => vi.fn() }));
vi.mock('@/context/fileActionState', () => ({ useFileLinkAction: () => null, useFileAction: () => null, useFileTargetInfo: () => null }));
vi.mock('../Toast', () => ({ useToast: () => ({ error: vi.fn() }), useToastOptional: () => null }));
vi.mock('@/theme', () => {
  const theme = { adapters: { prism: {} }, resolvedColorScheme: 'light' };
  return { useResolvedTheme: () => theme };
});
beforeAll(async () => {
  // This is a rendering/sanitization contract test, not a cold chunk timing test.
  await import('../Markdown');
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 10, 20);
});
describe('live projections through the real sanitized Markdown pipeline', () => {
  it('renders supported HTML and math while keeping source and removing unsafe HTML attributes', async () => {
    const source = 'Hello <kbd onclick="alert(1)">Ctrl</kbd> and <mark>highlight</mark>.\n\n$$ x^2 $$\n\n> $$\n> E=mc^2\n> $$\n\n- $$\n  a+b\n  $$';
    const ref = createRef<MarkdownEditorHandle>();
    const { rerender } = render(<MarkdownEditor ref={ref} path="notes.md" initialSource={source} sourceMode={false} allowImages={false} onChange={vi.fn()} onSave={vi.fn()} />);
    await waitFor(() => expect(document.querySelectorAll('.katex')).toHaveLength(3));
    expect(document.querySelector('kbd')?.textContent).toBe('Ctrl');
    expect(document.querySelector('kbd')?.hasAttribute('onclick')).toBe(false);
    expect(document.querySelector('mark')?.textContent).toBe('highlight');
    expect(ref.current?.getSource()).toBe(source);
    await act(async () => rerender(<MarkdownEditor ref={ref} path="notes.md" initialSource={source} sourceMode allowImages={false} onChange={vi.fn()} onSave={vi.fn()} />));
    expect(document.querySelector('.katex')).toBeNull();
    expect(ref.current?.getSource()).toBe(source);
  });
  it('renders list depth from syntax and refreshes markers after an indentation edit without rewriting source', async () => {
    const source = '- Parent\n  - Child\n    - Grandchild\n\n1. Ordered\n   - Mixed';
    const ref = createRef<MarkdownEditorHandle>();
    const { container } = render(<MarkdownEditor ref={ref} path="lists.md" initialSource={source} sourceMode={false} allowImages={false} onChange={vi.fn()} onSave={vi.fn()} />);
    const markers = () => [...container.querySelectorAll('.md-list-bullet')].map(element => element.textContent);
    await waitFor(() => expect(markers()).toEqual(['•', '◦', '▪', '◦']));
    expect(ref.current?.getSource()).toBe(source);
    const edited = source.replace('    - Grandchild', '  - Grandchild');
    await act(async () => ref.current?.replaceSource(edited, false));
    await waitFor(() => expect(markers()).toEqual(['•', '◦', '◦', '◦']));
    expect(ref.current?.getSource()).toBe(edited);
  });

  it.each(['- Item', '1. Item'])('constrains tables in list continuations (%s) and refreshes after unnesting', async (item) => {
    const table = '| A | B |\n| --- | --- |\n| value | second |';
    const source = item + '\n\n' + table.split('\n').map(line => '   ' + line).join('\n');
    const ref = createRef<MarkdownEditorHandle>();
    const { container } = render(<MarkdownEditor ref={ref} path="nested.md" initialSource={source} sourceMode={false} allowImages={false} onChange={vi.fn()} onSave={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('.md-projection-Table')?.classList.contains('md-projection-nested')).toBe(true));
    expect(ref.current?.getSource()).toBe(source);
    await act(async () => ref.current?.replaceSource(table, false));
    await waitFor(() => expect(container.querySelector('.md-projection-Table')?.classList.contains('md-projection-nested')).toBe(false));
  });

  it('exposes the live table scroller to the app gesture ownership gate', async () => {
    const { container } = render(<MarkdownEditor path="table.md" initialSource={'| A | B |\n| --- | --- |\n| value | second |'} sourceMode={false} allowImages={false} onChange={vi.fn()} onSave={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('.md-table-scroll td')).not.toBeNull());
    const scroller = container.querySelector<HTMLElement>('.md-table-scroll')!;
    Object.defineProperties(scroller, { clientWidth: { value: 100 }, scrollWidth: { value: 300 } });
    const owners: string[] = [];
    container.addEventListener('wheel', event => { owners.push(resolveHorizontalGestureOwnership(event, container).owner); });
    for (const scrollLeft of [0, 100, 200]) {
      scroller.scrollLeft = scrollLeft;
      scroller.querySelector('td')!.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaX: 96 }));
    }
    expect(owners).toEqual(['inner-horizontal', 'inner-horizontal', 'inner-horizontal']);
  });

  it('sizes a footnoted short cell from its visible reference, excluding hidden definition bodies', async () => {
    const source = '| 编号 | 状态 |\n| --- | --- |\n| 01[^a] | 好 |\n\n[^a]: 很长的脚注说明不应该把编号列撑成宽列';
    const ref = createRef<MarkdownEditorHandle>();
    const { container } = render(<MarkdownEditor ref={ref} path="footnote.md" initialSource={source} sourceMode={false} allowImages={false} onChange={vi.fn()} onSave={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('td .footnotes')).not.toBeNull());
    const cell = container.querySelector('td[data-md-column="0"]')!;
    await waitFor(() => expect(cell.getAttribute('data-table-sizing')).toBe('011'));
    expect(ref.current?.getSource()).toBe(source);
  });

});
