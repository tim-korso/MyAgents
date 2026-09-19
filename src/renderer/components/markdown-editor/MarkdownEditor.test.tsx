import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRef, useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import * as markdownClipboard from '@/utils/markdownClipboard';
import MarkdownEditor, { type MarkdownEditorHandle } from './MarkdownEditor';

const mocks = vi.hoisted(() => ({ dropOptions: vi.fn() }));
vi.mock('@/hooks/useTauriFileDrop', () => ({ useTauriFileDrop: (options: unknown) => {
  mocks.dropOptions(options);
  return { registerZone: vi.fn(), unregisterZone: vi.fn() };
} }));
vi.mock('@/hooks/useWorkspaceFileService', () => ({ useWorkspaceFileService: () => ({ isAvailable: true }) }));
vi.mock('@/context/BrowserPanelContext', () => ({ useOpenWebLink: () => vi.fn() }));
vi.mock('@/context/fileActionState', () => ({ useFileLinkAction: () => null }));
vi.mock('../Toast', () => ({ useToast: () => ({ error: vi.fn() }), useToastOptional: () => null }));
vi.mock('../Markdown', () => ({ default: ({ children }: { children: string }) => <span>{children}</span> }));
vi.mock('@/theme', () => {
  const theme = { adapters: { prism: {} }, resolvedColorScheme: 'light' };
  return { useResolvedTheme: () => theme };
});

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 10, 20);
});

const props = { path: 'notes.md', workspacePath: '/workspace', sourceMode: false, allowImages: false, onChange: vi.fn(), onSave: vi.fn() };
const editorView = () => EditorView.findFromDOM(document.querySelector('.md-editor-host .cm-editor') as HTMLElement)!;

describe('Markdown document state and projections', () => {
  it('rejects stale outline positions before the next measurement and navigates after refresh', async () => {
    const source = '# First\n\n' + 'body '.repeat(20) + '\n\n## Last';
    render(<MarkdownEditor {...props} initialSource={source} />);
    fireEvent.click(await screen.findByRole('button', { name: '浏览文档目录' }));
    const stale = await screen.findByRole('button', { name: 'Last' });
    const view = editorView();
    act(() => {
      view.dispatch({ changes: { from: 0, to: 9 } });
      fireEvent.click(stale);
    });
    expect(view.state.selection.main.head).toBe(0);
    expect(view.state.doc.toString()).toBe(source.slice(9));
    await waitFor(() => expect(document.querySelectorAll('.md-outline-tick')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: '浏览文档目录' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Last' }));
    expect(view.state.selection.main.head).toBe(source.slice(9).indexOf('## Last'));
  });
  it('refreshes the outline after external reload and releases it on source/hidden modes', async () => {
    const ref = createRef<MarkdownEditorHandle>();
    const candidate = { ...props, ref, initialSource: '# Before\n\nbody\n\n## Second' };
    const rendered = render(<MarkdownEditor {...candidate} />);
    fireEvent.click(await screen.findByRole('button', { name: '浏览文档目录' }));
    expect(await screen.findByRole('button', { name: 'Before' })).toBeInTheDocument();
    act(() => ref.current!.replaceSource('# Reloaded\n\n## New section', true));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Before' })).not.toBeInTheDocument());
    fireEvent.click(await screen.findByRole('button', { name: '浏览文档目录' }));
    expect(await screen.findByRole('button', { name: 'Reloaded' })).toBeInTheDocument();
    const view = editorView();
    rendered.rerender(<MarkdownEditor {...candidate} active={false} />);
    expect(screen.queryByRole('navigation', { name: '目录' })).toBeNull();
    rendered.rerender(<MarkdownEditor {...candidate} sourceMode />);
    expect(screen.queryByRole('button', { name: '浏览文档目录' })).toBeNull();
    rendered.rerender(<MarkdownEditor {...candidate} />);
    expect(await screen.findByRole('button', { name: '浏览文档目录' })).toBeInTheDocument();
    expect(editorView()).toBe(view);
    act(() => ref.current!.replaceSource('No headings', true));
    await waitFor(() => expect(screen.queryByRole('button', { name: '浏览文档目录' })).toBeNull());
  });
  it('copies the current complete code body even when the header only projects the first line', async () => {
    const copy = vi.spyOn(markdownClipboard, 'copyPlainText').mockResolvedValue();
    try {
      render(<MarkdownEditor {...props} initialSource={'```ts\nconst value = 1;\nsecond line\n```'} />);
      const view = editorView();
      act(() => view.dispatch({ changes: { from: 20, to: 21, insert: '2' } }));
      fireEvent.click(await screen.findByRole('button', { name: '复制代码' }));
      expect(copy).toHaveBeenCalledWith('const value = 2;\nsecond line');
    } finally { copy.mockRestore(); }
  });

  it.each(['search', 'table'])('hides inactive %s menus and disables drops while preserving the CM history', async menu => {
    const source = 'text\n\n| A | B |\n| --- | --- |\n| old | two |';
    const ref = createRef<MarkdownEditorHandle>();
    const candidate = { ...props, ref, initialSource: source, allowImages: true };
    const rendered = render(<MarkdownEditor {...candidate} active />);
    const view = editorView();
    act(() => view.dispatch({ changes: { from: 0, insert: 'new ' }, userEvent: 'input.type' }));
    const option = menu === 'search' ? '区分大小写' : '在下方插入行';
    if (menu === 'search') {
      act(() => runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }), 'editor'));
      fireEvent.click(screen.getByRole('button', { name: '查找选项' }));
    } else {
      fireEvent.click(await screen.findByRole('button', { name: '表格操作' }));
    }
    expect(await screen.findByText(option)).toBeInTheDocument();
    rendered.rerender(<MarkdownEditor {...candidate} active={false} />);
    await waitFor(() => expect(screen.queryByText(option)).toBeNull());
    expect(mocks.dropOptions).toHaveBeenLastCalledWith({ enabled: false });
    expect(view.dom.closest('[inert]')).not.toBeNull();
    expect(editorView()).toBe(view);
    expect(ref.current?.getSource()).toBe('new ' + source);
    rendered.rerender(<MarkdownEditor {...candidate} active />);
    expect(await screen.findByText(option)).toBeInTheDocument();
    expect(mocks.dropOptions).toHaveBeenLastCalledWith({ enabled: true });
    expect(editorView()).toBe(view);
    act(() => { expect(undo(view)).toBe(true); });
    expect(ref.current?.getSource()).toBe(source);
    act(() => { expect(redo(view)).toBe(true); });
    expect(ref.current?.getSource()).toBe('new ' + source);
  });

  it('shows formatting only for selected text and separates the chat quote action', () => {
    const onQuote = vi.fn();
    render(<MarkdownEditor {...props} initialSource="hello world" onQuote={onQuote} />);
    const view = editorView();
    act(() => { view.focus(); view.dispatch({ selection: { anchor: 3 } }); });
    expect(screen.queryByRole('toolbar')).toBeNull();
    act(() => view.dispatch({ selection: { anchor: 0, head: 5 } }));
    const toolbar = screen.getByRole('toolbar');
    expect(within(toolbar).getByRole('separator')).toHaveAttribute('aria-orientation', 'vertical');
    const quote = within(toolbar).getByRole('button', { name: '引用' });
    expect(quote.querySelector('svg')).not.toBeNull();
    fireEvent.click(quote);
    expect(onQuote).toHaveBeenCalledWith({ text: 'hello', startLine: 1, endLine: 1 });
    act(() => view.dispatch({ selection: { anchor: 2 } }));
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it.each(['keyboard', 'beforeinput'] as const)('keeps cell undo/redo at parent history with focus via %s', async input => {
    const ref = createRef<MarkdownEditorHandle>();
    const source = '| A | B |\n| --- | --- |\n| old | two |';
    render(<MarkdownEditor {...props} ref={ref} initialSource={source} />);
    fireEvent.click(await screen.findByRole('cell', { name: '第 2 行，第 1 列' }));
    const mini = EditorView.findFromDOM(document.querySelector('.md-cell-editor .cm-editor') as HTMLElement)!;
    act(() => mini.dispatch({ changes: { from: 0, to: 3, insert: 'new' }, userEvent: 'input.type' }));
    act(() => {
      if (input === 'keyboard') fireEvent.keyDown(mini.contentDOM, { key: 'z', ctrlKey: true });
      else mini.contentDOM.dispatchEvent(new InputEvent('beforeinput', { inputType: 'historyUndo', bubbles: true, cancelable: true }));
    });
    expect(ref.current?.getSource()).toBe(source);
    expect(editorView().contentDOM).toHaveFocus();
    // A second command follows the real focus owner, not a saved view handle.
    fireEvent.keyDown(document.activeElement!, { key: 'y', ctrlKey: true });
    expect(ref.current?.getSource()).toContain('| new | two |');
  });

  it.each(['table-action', 'tsv-paste'] as const)('returns focus after %s so the next shortcut undoes its transaction', async input => {
    const source = '| A | B |\n| --- | --- |\n| old | two |';
    render(<MarkdownEditor {...props} initialSource={source} />);
    fireEvent.click(await screen.findByRole('cell', { name: '第 2 行，第 1 列' }));
    if (input === 'table-action') {
      fireEvent.click(screen.getByRole('button', { name: '表格操作' }));
      const action = await screen.findByRole('button', { name: '在下方插入行' });
      act(() => action.focus());
      fireEvent.click(action);
    } else {
      fireEvent.paste(document.activeElement!, { clipboardData: { files: [], getData: () => 'one\ttwo' } });
    }
    expect(editorView().state.doc.toString()).not.toBe(source);
    expect(editorView().contentDOM).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'z', ctrlKey: true });
    expect(editorView().state.doc.toString()).toBe(source);
    fireEvent.keyDown(document.activeElement!, { key: 'y', ctrlKey: true });
    expect(editorView().state.doc.toString()).not.toBe(source);
  });

  it('undoes and redoes toolbar code formatting through delivered input commands', () => {
    const ref = createRef<MarkdownEditorHandle>();
    render(<MarkdownEditor {...props} ref={ref} initialSource="hello world" />);
    const view = editorView();
    act(() => { view.focus(); view.dispatch({ selection: { anchor: 0, head: 5 } }); });
    fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: '代码' }));
    expect(ref.current?.getSource()).toBe('`hello` world');
    fireEvent.keyDown(document.activeElement!, { key: 'z', ctrlKey: true });
    expect(ref.current?.getSource()).toBe('hello world');
    act(() => document.activeElement!.dispatchEvent(new InputEvent('beforeinput', { inputType: 'historyRedo', bubbles: true, cancelable: true })));
    expect(ref.current?.getSource()).toBe('`hello` world');
  });

  it('opens compact search by shortcut, keeps options behind more, and replaces through parent undo', async () => {
    const ref = createRef<MarkdownEditorHandle>();
    render(<MarkdownEditor {...props} ref={ref} initialSource="one ONE stone one" />);
    const view = editorView();
    act(() => view.dispatch({ selection: { anchor: 0, head: 3 } }));
    expect(within(screen.getByRole('toolbar')).queryByRole('button', { name: '查找' })).toBeNull();
    act(() => runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }), 'editor'));
    const input = await screen.findByRole('textbox', { name: '查找' });
    expect(input).toHaveFocus();
    expect(input).toHaveValue('one');
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('textbox', { name: '替换' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查找选项' }));
    const caseOption = await screen.findByRole('checkbox', { name: '区分大小写' });
    expect(caseOption).toHaveFocus();
    fireEvent.click(caseOption);
    fireEvent.click(screen.getByRole('checkbox', { name: '全词匹配' }));
    fireEvent.change(screen.getByRole('textbox', { name: '替换' }), { target: { value: 'new' } });
    fireEvent.click(screen.getByRole('button', { name: '全部替换' }));
    expect(ref.current?.getSource()).toBe('new ONE stone new');
    act(() => undo(view));
    expect(ref.current?.getSource()).toBe('one ONE stone one');
    fireEvent.keyDown(screen.getByRole('textbox', { name: '替换' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '查找选项' })).toBeNull();
    expect(screen.getByRole('button', { name: '查找选项' })).toHaveFocus();
    expect(input).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('search')).toBeNull();
    expect(editorView()).toBe(view);
  });

  it('selects every search match for one parent input transaction and undo', async () => {
    const ref = createRef<MarkdownEditorHandle>();
    render(<MarkdownEditor {...props} ref={ref} initialSource="cat cat cat" />);
    const view = editorView();
    act(() => runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }), 'editor'));
    fireEvent.change(await screen.findByRole('textbox', { name: '查找' }), { target: { value: 'cat' } });
    fireEvent.click(screen.getByRole('button', { name: '查找选项' }));
    fireEvent.click(await screen.findByRole('button', { name: '选择全部匹配' }));
    expect(view.state.selection.ranges.map(range => [range.from, range.to])).toEqual([[0, 3], [4, 7], [8, 11]]);
    expect(view.contentDOM).toHaveFocus();
    act(() => view.dispatch(view.state.replaceSelection('X'), { userEvent: 'input.type' }));
    expect(ref.current?.getSource()).toBe('X X X');
    act(() => undo(view));
    expect(ref.current?.getSource()).toBe('cat cat cat');
  });

  it('returns focus to the same document after keyboard-activated whole-source exit', () => {
    function SourceSurface() {
      const [sourceMode, setSourceMode] = useState(true);
      return <MarkdownEditor {...props} initialSource="# Title" sourceMode={sourceMode} onExitSource={() => setSourceMode(false)} />;
    }
    render(<SourceSurface />);
    const view = editorView(), exit = screen.getByRole('button', { name: '退出源码模式' });
    act(() => exit.focus());
    // Keyboard activation fires click without the mouse-down focus guard.
    fireEvent.click(exit, { detail: 0 });
    expect(screen.queryByRole('button', { name: '退出源码模式' })).toBeNull();
    expect(view.contentDOM).toHaveFocus();
    expect(editorView()).toBe(view);
  });

  it('navigates search with Enter/Shift+Enter, ignores IME Enter, and hides replacement when paused', async () => {
    const { rerender } = render(<MarkdownEditor {...props} initialSource="cat cat" />);
    const view = editorView();
    act(() => runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }), 'editor'));
    const input = await screen.findByRole('textbox', { name: '查找' });
    fireEvent.change(input, { target: { value: 'cat' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(view.state.selection.main.from).toBe(0);
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(view.state.selection.main.from).toBe(0);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(view.state.selection.main.from).toBe(4);
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(view.state.selection.main.from).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: '查找选项' }));
    await screen.findByRole('textbox', { name: '替换' });
    rerender(<MarkdownEditor {...props} initialSource="cat cat" paused />);
    expect(screen.queryByRole('textbox', { name: '替换' })).toBeNull();
  });

  it('edits a reference link destination without rewriting its label', async () => {
    const ref = createRef<MarkdownEditorHandle>();
    render(<MarkdownEditor {...props} ref={ref} initialSource={'Read [the guide][ref].\n\n[ref]: https://example.com "Title"'} />);
    act(() => editorView().dispatch({ selection: { anchor: 9 } }));
    act(() => runScopeHandlers(editorView(), new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }), 'editor'));
    const input = await screen.findByRole('textbox', { name: '链接地址' });
    expect(input).toHaveValue('https://example.com');
    fireEvent.change(input, { target: { value: 'https://example.com/new' } });
    fireEvent.submit(input.closest('form')!);
    expect(ref.current?.getSource()).toBe('Read [the guide][ref].\n\n[ref]: <https://example.com/new> "Title"');
    act(() => undo(editorView()));
    expect(ref.current?.getSource()).toContain('[ref]: https://example.com "Title"');
  });
  it('opens editable, preserves exact source and history across both modes', async () => {
    const ref = createRef<MarkdownEditorHandle>();
    const source = '\uFEFF# Title\r\n\r\n**Body**\nend\r';
    const { rerender } = render(<MarkdownEditor {...props} ref={ref} initialSource={source} />);
    expect(ref.current?.getSource()).toBe(source);
    act(() => editorView().dispatch({ changes: { from: editorView().state.doc.length, insert: 'edit' }, userEvent: 'input' }));
    rerender(<MarkdownEditor {...props} ref={ref} initialSource={source} sourceMode />);
    expect(ref.current?.getSource()).toBe(source + 'edit');
    act(() => undo(editorView()));
    expect(ref.current?.getSource()).toBe(source);
    rerender(<MarkdownEditor {...props} ref={ref} initialSource={source} />);
    act(() => redo(editorView()));
    expect(ref.current?.getSource()).toBe(source + 'edit');
  });

  it('makes external reload an undo boundary and merged content one undo entry', () => {
    const ref = createRef<MarkdownEditorHandle>();
    render(<MarkdownEditor {...props} ref={ref} initialSource="base" />);
    act(() => editorView().dispatch({ changes: { from: 4, insert: ' local' }, userEvent: 'input' }));
    act(() => ref.current?.replaceSource('disk\r\n', true));
    expect(undo(editorView())).toBe(false);
    act(() => ref.current?.replaceSource('merged\n', false));
    act(() => undo(editorView()));
    expect(ref.current?.getSource()).toBe('disk\r\n');
  });

  it('projects a table and sends cell typing and TSV paste to parent history', async () => {
    const ref = createRef<MarkdownEditorHandle>();
    const source = '| A | B |\n| --- | --- |\n| old | two |\n';
    render(<MarkdownEditor {...props} ref={ref} initialSource={source} />);
    const cell = await screen.findByRole('cell', { name: '第 2 行，第 1 列' });
    fireEvent.click(cell);
    await waitFor(() => expect(document.querySelector('.md-cell-editor .cm-editor')).not.toBeNull());
    const mini = EditorView.findFromDOM(document.querySelector('.md-cell-editor .cm-editor') as HTMLElement)!;
    act(() => mini.dispatch({ changes: { from: 0, to: 3, insert: 'new' }, userEvent: 'input' }));
    expect(ref.current?.getSource()).toContain('| new | two |');
    // A cell update must keep its composing/input view mounted.
    expect(EditorView.findFromDOM(document.querySelector('.md-cell-editor .cm-editor') as HTMLElement)).toBe(mini);
    fireEvent.paste(mini.contentDOM, { clipboardData: { getData: () => 'x\ty\nz\tw' } });
    expect(ref.current?.getSource()).toContain('| x | y |');
    expect(ref.current?.getSource()).toContain('| z | w |');
    act(() => undo(editorView()));
    expect(ref.current?.getSource()).toContain('| new | two |');
  });
  it('defers whole-source switching until a composing table cell commits', async () => {
    const ref = createRef<MarkdownEditorHandle>(), source = '| A |\n| --- |\n| old |\n';
    const { rerender } = render(<MarkdownEditor {...props} ref={ref} initialSource={source} />);
    fireEvent.click(await screen.findByRole('cell', { name: '第 2 行，第 1 列' }));
    const mini = EditorView.findFromDOM(document.querySelector('.md-cell-editor .cm-editor') as HTMLElement)!;
    fireEvent.compositionStart(mini.contentDOM);
    act(() => mini.dispatch({ changes: { from: 0, to: 3, insert: '中文' }, userEvent: 'input.type.compose' }));
    rerender(<MarkdownEditor {...props} ref={ref} initialSource={source} sourceMode />);
    expect(document.querySelector('.md-cell-editor .cm-editor')).toBe(mini.dom);
    fireEvent.compositionEnd(mini.contentDOM);
    await waitFor(() => expect(editorView().dom).toHaveClass('md-source-mode'));
    expect(ref.current?.getSource()).toContain('| 中文 |');
  });

  it('reveals a source search hit inside a table and keeps every requested match', async () => {
    const source = '| A | B |\n| --- | --- |\n| same | same |';
    const { rerender } = render(<MarkdownEditor {...props} initialSource={source} />);
    await screen.findByRole('cell', { name: '第 2 行，第 1 列' });
    rerender(<MarkdownEditor {...props} initialSource={source} focusTarget={{ requestId: 1, lineNumber: 3, query: 'same' }} />);
    expect(document.querySelectorAll('.md-focus-match')).toHaveLength(2);
    expect(document.querySelector('.md-cell-editor')).toBeNull();
    expect(editorView().state.sliceDoc(editorView().state.selection.main.from, editorView().state.selection.main.to)).toBe('same');
  });

  it('keeps sequential spaces and escapes in the exact active cell slice', async () => {
    const ref = createRef<MarkdownEditorHandle>();
    render(<MarkdownEditor {...props} ref={ref} initialSource={'| A | B |\n| --- | --- |\n| old| two |'} />);
    fireEvent.click(await screen.findByRole('cell', { name: '第 2 行，第 1 列' }));
    const mini = EditorView.findFromDOM(document.querySelector('.md-cell-editor .cm-editor') as HTMLElement)!;
    for (const char of [' ', 'word', ' ', '中文', '\\', ' ', 'end']) {
      await act(async () => { mini.dispatch({ changes: { from: mini.state.doc.length, insert: char }, userEvent: 'input.type' }); });
    }
    expect(mini.state.doc.toString()).toBe('old word 中文\\ end');
    expect(ref.current?.getSource()).toContain('| old word 中文\\ end | two |');
  });

  it('maps initial cell selection before link/format commands and keeps parent undo', async () => {
    const ref = createRef<MarkdownEditorHandle>(), source = 'before\n\n| A | B |\n| --- | --- |\n| old | two |';
    render(<MarkdownEditor {...props} ref={ref} initialSource={source} />);
    fireEvent.click(await screen.findByRole('cell', { name: '第 2 行，第 1 列' }));
    const mini = EditorView.findFromDOM(document.querySelector('.md-cell-editor .cm-editor') as HTMLElement)!;
    expect(editorView().state.selection.main.from).toBe(source.indexOf('old'));
    act(() => { runScopeHandlers(mini, new KeyboardEvent('keydown', { key: 'b', ctrlKey: true }), 'editor'); });
    expect(ref.current?.getSource()).toContain('| ****old | two |');
    expect(ref.current?.getSource()?.startsWith('before')).toBe(true);
    act(() => undo(editorView()));
    expect(ref.current?.getSource()).toBe(source);
  });

});
