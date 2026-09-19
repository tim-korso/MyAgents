import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRef, useContext, useEffect, useLayoutEffect, useImperativeHandle, useRef, useState, type Ref, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TabActiveContext, TabApiContext } from '@/context/TabContext';
import { dismissTopmost } from '@/utils/closeLayer';

import FilePreviewModal, {
  type FilePreviewHandle,
  decideLiveReload,
  formatFilePreviewUpdateTime,
} from './FilePreviewModal';

const mocks = vi.hoisted(() => ({
  moves: new Set<(moves: { oldPath: string; newPath: string }[]) => void>(),
  readPreview: vi.fn(),
  saveFile: vi.fn(),
  saveMarkdownCopy: vi.fn(),
  checkPaths: vi.fn(),
  rename: vi.fn(),
  openInFinder: vi.fn(),
  openPathExternal: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastWarning: vi.fn(),
  copyMarkdownAsRichText: vi.fn(),
  copyPlainText: vi.fn(),
}));

vi.mock('@/hooks/useWorkspaceFileService', () => ({
  useWorkspaceFileService: () => ({
    isAvailable: true,
    readPreview: mocks.readPreview,
    saveFile: mocks.saveFile,
    saveMarkdownCopy: mocks.saveMarkdownCopy,
    checkPaths: mocks.checkPaths,
    rename: mocks.rename,
    openInFinder: mocks.openInFinder,
    openPathExternal: mocks.openPathExternal,
  }),
}));

vi.mock('@/hooks/useWorkspaceChangeSignal', () => ({
  useWorkspaceChangeSignal: (_workspace: unknown, _enabled: unknown, onMoved?: (moves: { oldPath: string; newPath: string }[]) => void) => {
    useEffect(() => {
      if (!onMoved) return;
      mocks.moves.add(onMoved);
      return () => { mocks.moves.delete(onMoved); };
    }, [onMoved]);
    return 0;
  },
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({
    showToast: vi.fn(),
    success: mocks.toastSuccess,
    error: mocks.toastError,
    warning: mocks.toastWarning,
    info: vi.fn(),
  }),
}));

vi.mock('@/utils/markdownClipboard', () => ({
  copyMarkdownAsRichText: mocks.copyMarkdownAsRichText,
  copyPlainText: mocks.copyPlainText,
}));

vi.mock('./Tip', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('./Markdown', () => ({
  default: ({ children }: { children: ReactNode }) => (
    <div data-testid="markdown-preview">{children}</div>
  ),
}));

vi.mock('./MonacoEditor', () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      data-testid="monaco-editor"
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  ),
}));

vi.mock('./markdown-editor/MarkdownEditor', () => ({
  default: function MockMarkdownEditor({ ref, initialSource, onChange, onDetach, path, sourceMode, paused, active = true }: { ref: Ref<import('./markdown-editor/MarkdownEditor').MarkdownEditorHandle>; initialSource: string; onChange: () => void; onDetach?: (source: string, path: string) => void; path: string; sourceMode: boolean; paused?: boolean; active?: boolean }) {
    const [value, setValue] = useState(initialSource);
    const current = useRef(value), revision = useRef(0);
    current.current = value;
    const latest = useRef({ onDetach, path }); latest.current = { onDetach, path };
    useLayoutEffect(() => () => latest.current.onDetach?.(current.current, latest.current.path), []);
    useImperativeHandle(ref, () => ({ getSource: () => current.current, getRevision: () => revision.current,
      replaceSource: next => { current.current = next; revision.current++; setValue(next); },
      settleComposition: async () => true, settleImports: async () => {}, invalidateImports: () => {}, setImportsEnabled: () => {}, focus: () => {},
    }), []);
    return <textarea data-testid="markdown-editor" className="overflow-auto" data-source-mode={sourceMode} data-active={active} readOnly={paused} value={value} onChange={event => {
      current.current = event.currentTarget.value; revision.current++; setValue(current.current); onChange();
    }} />;
  },
}));

const baseProps = {
  name: 'notes.md',
  content: 'old content',
  size: 11,
  path: 'notes.md',
  workspacePath: '/workspace',
  embedded: true,
  onClose: vi.fn(),
};

describe('FilePreviewModal live reload', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  async function openLineComparison() {
    mocks.readPreview.mockResolvedValue({ name: 'notes.md', content: 'first disk\nsecond disk\n', size: 23 });
    const props = { ...baseProps, content: 'base\n', externalRefreshSignal: 0 };
    const rendered = render(<FilePreviewModal {...props} />);
    fireEvent.change(await screen.findByTestId('markdown-editor'), { target: { value: 'first local\nsecond local\n' } });
    rendered.rerender(<FilePreviewModal {...props} externalRefreshSignal={1} />);
    fireEvent.click(await screen.findByRole('button', { name: '逐行比较' }));
    const dialog = await screen.findByRole('dialog', { name: '处理文件修改' });
    fireEvent.click(await within(dialog).findByRole('button', { name: '采用本地草稿第 1 行' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '采用磁盘版本第 2 行' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '检查组合结果' }));
    return { ...rendered, dialog, props };
  }

  it('keeps both originals and row choices through a failed save, then applies once after retry', async () => {
    const { dialog } = await openLineComparison();
    mocks.saveFile.mockRejectedValueOnce(new Error('permission denied')).mockResolvedValueOnce(undefined);
    expect(screen.getByTestId('markdown-editor')).toHaveAttribute('readonly');
    fireEvent.click(within(dialog).getByRole('button', { name: '应用并保存' }));
    await within(dialog).findByRole('alert');
    expect(screen.getByTestId('markdown-editor')).toHaveValue('first local\nsecond local\n');
    expect(within(dialog).getByRole('button', { name: '采用本地草稿第 1 行' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(dialog).getByRole('button', { name: '应用并保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('markdown-editor')).toHaveValue('first local\nsecond disk\n');
    expect(mocks.saveFile).toHaveBeenCalledTimes(2);
    expect(mocks.saveFile).toHaveBeenLastCalledWith({ path: 'notes.md', content: 'first local\nsecond disk\n', expectedContent: 'first disk\nsecond disk\n' });
  });
  it('saves a conflict copy then adopts the freshly checked disk version', async () => {
    const { dialog } = await openLineComparison();
    mocks.saveMarkdownCopy.mockResolvedValueOnce({ path: 'notes_local-copy.md' });
    fireEvent.click(within(dialog).getByRole('button', { name: '草稿另存副本' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.saveMarkdownCopy).toHaveBeenCalledWith({ documentPath: 'notes.md', content: 'first local\nsecond local\n' });
    expect(screen.getByTestId('markdown-editor')).toHaveValue('first disk\nsecond disk\n');
  });
  it('allows closing a missing original after a confirmed copy of the current draft', async () => {
    const ref = createRef<FilePreviewHandle>(), onClose = vi.fn();
    mocks.readPreview.mockRejectedValue(new Error('File not found'));
    mocks.checkPaths.mockResolvedValue({ results: { 'notes.md': { exists: false } } });
    mocks.saveMarkdownCopy.mockResolvedValueOnce({ path: 'notes_local-copy.md' });
    const props = { ...baseProps, ref, onClose };
    const { rerender } = render(<FilePreviewModal {...props} externalRefreshSignal={0} />);
    fireEvent.change(await screen.findByTestId('markdown-editor'), { target: { value: 'my draft' } });
    rerender(<FilePreviewModal {...props} externalRefreshSignal={1} />);
    fireEvent.click(await screen.findByRole('button', { name: '草稿另存副本' }));
    await waitFor(() => expect(mocks.checkPaths).toHaveBeenCalled());
    await act(async () => { ref.current?.close(); });
    expect(onClose).toHaveBeenCalledOnce();
    expect(mocks.saveFile).not.toHaveBeenCalled();
    mocks.readPreview.mockReset();
  });
  it('keeps newer edits when a copy of an older revision finishes', async () => {
    let complete!: (copy: { path: string }) => void;
    mocks.saveMarkdownCopy.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const ref = createRef<FilePreviewHandle>();
    mocks.saveFile.mockRejectedValue(new Error('denied'));
    render(<FilePreviewModal {...baseProps} ref={ref} />);
    fireEvent.change(await screen.findByTestId('markdown-editor'), { target: { value: 'snapshot' } });
    await act(async () => { expect(await ref.current?.prepareTransition()).toBe(false); });
    fireEvent.click(screen.getByRole('button', { name: '草稿另存副本' }));
    await waitFor(() => expect(mocks.saveMarkdownCopy).toHaveBeenCalled());
    fireEvent.change(screen.getByTestId('markdown-editor'), { target: { value: 'newer input' } });
    await act(async () => complete({ path: 'notes_local-copy.md' }));
    expect(screen.getByTestId('markdown-editor')).toHaveValue('newer input');
    expect(mocks.readPreview).not.toHaveBeenCalled();
    mocks.saveFile.mockReset();
  });
  it('admits file navigation only after the current draft has saved', async () => {
    const ref = createRef<FilePreviewHandle>();
    function Navigation() {
      const [path, setPath] = useState('a.md');
      return <><button onClick={async () => { if (await ref.current?.prepareTransition('b.md')) setPath('b.md'); }}>next file</button>
        <FilePreviewModal {...baseProps} ref={ref} name={path} path={path} content={path === 'a.md' ? 'A' : 'B'} /></>;
    }
    render(<Navigation />);
    fireEvent.change(await screen.findByTestId('markdown-editor'), { target: { value: 'unsaved A' } });
    mocks.saveFile.mockRejectedValueOnce(new Error('denied'));
    fireEvent.click(screen.getByRole('button', { name: 'next file' }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(screen.getByTestId('markdown-editor')).toHaveValue('unsaved A');
    mocks.saveFile.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'next file' }));
    await waitFor(() => expect(screen.getByTestId('markdown-editor')).toHaveValue('B'));
    expect(mocks.saveFile).toHaveBeenLastCalledWith({ path: 'a.md', content: 'unsaved A', expectedContent: 'A' });
  });

  it('reconciles an unknown write receipt without writing the result twice', async () => {
    const { dialog } = await openLineComparison();
    mocks.readPreview.mockResolvedValueOnce({ name: 'notes.md', content: 'first disk\nsecond disk\n' }).mockRejectedValueOnce(new Error('IPC disconnected'));
    mocks.saveFile.mockRejectedValueOnce(new Error('IPC disconnected'));
    fireEvent.click(within(dialog).getByRole('button', { name: '应用并保存' }));
    const check = await within(dialog).findByRole('button', { name: '检查保存结果' });
    expect(within(dialog).getByRole('button', { name: '采用本地草稿第 1 行' })).toBeDisabled();
    mocks.readPreview.mockResolvedValueOnce({ name: 'notes.md', content: 'first local\nsecond disk\n' });
    fireEvent.click(check);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.saveFile).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('markdown-editor')).toHaveValue('first local\nsecond disk\n');
  });

  it('retains hidden choices as stale after editing and reopening the comparison', async () => {
    const { dialog } = await openLineComparison();
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('markdown-editor')).not.toHaveAttribute('readonly');
    fireEvent.change(screen.getByTestId('markdown-editor'), { target: { value: 'new local draft' } });
    fireEvent.click(screen.getByRole('button', { name: '逐行比较' }));
    await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: '采用本地草稿第 1 行' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByRole('button', { name: '采用本地草稿第 1 行' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '应用并保存' })).toBeDisabled();
  });

  it('does not write the seed text back when a saved Markdown editor unmounts', async () => {
    mocks.saveFile.mockResolvedValue(undefined);
    function Viewer() {
      const [open, setOpen] = useState(true);
      return open ? <FilePreviewModal {...baseProps} onClose={() => setOpen(false)} /> : <span>closed</span>;
    }
    render(<Viewer />);
    fireEvent.change(await screen.findByTestId('markdown-editor'), { target: { value: 'latest saved content' } });
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await screen.findByText('closed');
    expect(mocks.saveFile).toHaveBeenCalledTimes(1);
    expect(mocks.saveFile).toHaveBeenCalledWith({ path: 'notes.md', content: 'latest saved content', expectedContent: 'old content' });
  });

  it('retains dirty edits when closing cannot save', async () => {
    mocks.saveFile.mockRejectedValue(new Error('File not found'));
    const onClose = vi.fn();
    render(<FilePreviewModal {...baseProps} initialEditMode onClose={onClose} />);
    fireEvent.change(await screen.findByTestId('markdown-editor'), { target: { value: 'unsaved draft' } });
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('markdown-editor')).toHaveValue('unsaved draft');
    mocks.saveFile.mockResolvedValue(undefined);
  });

  it('remaps all open descendants and preserves independent dirty buffers', async () => {
    mocks.saveFile.mockResolvedValue(undefined);
    function Viewer({ file }: { file: string }) {
      const [identity, setIdentity] = useState({ path: `old/${file}`, name: file });
      return <FilePreviewModal {...baseProps} {...identity} initialEditMode
        onRenamed={(path, name) => setIdentity({ path, name })} />;
    }
    render(<><Viewer file="a.md" /><Viewer file="b.md" /></>);
    const editors = await screen.findAllByTestId('markdown-editor');
    fireEvent.change(editors[0], { target: { value: 'draft a' } });
    fireEvent.change(editors[1], { target: { value: 'draft b' } });
    act(() => mocks.moves.forEach(callback => callback([{ oldPath: 'old', newPath: 'new' }])));
    fireEvent.click(screen.getAllByRole('button', { name: '关闭' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: '关闭' })[1]);
    await waitFor(() => {
      expect(mocks.saveFile).toHaveBeenCalledWith({ path: 'new/a.md', content: 'draft a', expectedContent: 'old content' });
      expect(mocks.saveFile).toHaveBeenCalledWith({ path: 'new/b.md', content: 'draft b', expectedContent: 'old content' });
    });
  });

  it('retains a draft on failed close and can expand without saving', async () => {
    mocks.saveFile.mockRejectedValue(new Error('File not found'));
    const onClose = vi.fn();
    const onFullscreen = vi.fn();
    const ref = createRef<FilePreviewHandle>();
    render(<FilePreviewModal {...baseProps} ref={ref} initialEditMode onClose={onClose} onFullscreen={onFullscreen} />);
    fireEvent.change(await screen.findByTestId('markdown-editor'), { target: { value: 'draft' } });
    act(() => ref.current?.close());
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByLabelText('全屏预览'));
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onFullscreen).not.toHaveBeenCalled();
    expect(screen.getByTestId('markdown-editor')).toHaveValue('draft');
    mocks.saveFile.mockResolvedValue(undefined);
  });

  it('hides an inactive Tab fullscreen editor without losing its document or consuming close', async () => {
    function Viewer({ active }: { active: boolean }) {
      const api = useContext(TabApiContext);
      return <TabApiContext value={{ ...api, tabId: 'tab-1' }}><TabActiveContext value={active}>
        <FilePreviewModal {...baseProps} onFullscreen={vi.fn()} />
      </TabActiveContext></TabApiContext>;
    }
    const rendered = render(<Viewer active />);
    const editor = await screen.findByTestId('markdown-editor');
    fireEvent.change(editor, { target: { value: 'kept draft' } });
    fireEvent.click(screen.getByLabelText('全屏预览'));
    expect(await screen.findByRole('dialog')).toBeVisible();
    rendered.rerender(<Viewer active={false} />);
    expect(editor).not.toBeVisible();
    expect(editor).toHaveAttribute('data-active', 'false');
    expect(dismissTopmost()).toBe(false);
    rendered.rerender(<Viewer active />);
    expect(await screen.findByRole('dialog')).toBeVisible();
    expect(screen.getByTestId('markdown-editor')).toBe(editor);
    expect(editor).toHaveValue('kept draft');
    expect(editor).toHaveAttribute('data-active', 'true');
    act(() => expect(dismissTopmost()).toBe(true));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(editor).toHaveValue('kept draft');
  });

  it('enters fullscreen with the latest document identity after a move during save', async () => {
    let finishSave!: () => void;
    mocks.saveFile.mockImplementationOnce(() => new Promise<void>(resolve => { finishSave = resolve; }));
    mocks.saveFile.mockResolvedValue(undefined);
    function Viewer() {
      const [file, setFile] = useState({ path: 'notes.ts', name: 'notes.ts', content: 'old content' });
      const [fullscreen, setFullscreen] = useState<typeof file | null>(null);
      return <><span data-testid="fullscreen-path">{fullscreen?.path}</span>
        <FilePreviewModal {...baseProps} {...(fullscreen ?? file)} embedded={!fullscreen} initialEditMode
          onRenamed={(path, name) => setFile(prev => ({ ...prev, path, name }))}
          onFullscreen={content => setFullscreen({ ...file, content: content ?? file.content })} /></>;
    }
    render(<Viewer />);
    fireEvent.change(await screen.findByTestId('monaco-editor'), { target: { value: 'saved draft' } });
    fireEvent.click(screen.getByLabelText('全屏预览'));
    await waitFor(() => expect(mocks.saveFile).toHaveBeenCalledTimes(1));
    act(() => mocks.moves.forEach(callback => callback([{ oldPath: 'notes.ts', newPath: 'renamed.ts' }])));
    await act(async () => finishSave());
    expect(screen.getByTestId('fullscreen-path')).toHaveTextContent('renamed.ts');
    expect(screen.getByTestId('monaco-editor')).toHaveValue('saved draft');
    fireEvent.change(screen.getByTestId('monaco-editor'), { target: { value: 'fullscreen edit' } });
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(mocks.saveFile).toHaveBeenLastCalledWith({ path: 'renamed.ts', content: 'fullscreen edit', expectedContent: 'saved draft' }));
  });

  it('preserves the draft through an extension rename but resets on a real document switch', async () => {
    function Viewer() {
      const [identity, setIdentity] = useState({ path: 'notes.md', name: 'notes.md' });
      return <><button onClick={() => setIdentity({ path: 'other.txt', name: 'other.txt' })}>other</button>
        <FilePreviewModal {...baseProps} {...identity} initialEditMode onRenamed={(path, name) => setIdentity({ path, name })} /></>;
    }
    render(<Viewer />);
    fireEvent.change(await screen.findByTestId('markdown-editor'), { target: { value: 'draft' } });
    act(() => mocks.moves.forEach(callback => callback([{ oldPath: 'notes.md', newPath: 'notes.txt' }])));
    expect(await screen.findByTestId('monaco-editor')).toHaveValue('draft');
    fireEvent.click(screen.getByRole('button', { name: 'other' }));
    expect(screen.getByTestId('monaco-editor')).toHaveValue('old content');
  });

  it('settles an in-flight save across a move before saving newer edits at the new path', async () => {
    let finishSave!: () => void;
    mocks.saveFile.mockImplementationOnce(() => new Promise<void>(resolve => { finishSave = resolve; }));
    mocks.saveFile.mockResolvedValue(undefined);
    function Viewer() {
      const [identity, setIdentity] = useState({ path: 'notes.md', name: 'notes.md' });
      return <FilePreviewModal {...baseProps} {...identity} initialEditMode onRenamed={(path, name) => setIdentity({ path, name })} />;
    }
    render(<Viewer />);
    const editor = await screen.findByTestId('markdown-editor');
    fireEvent.change(editor, { target: { value: 'first draft' } });
    await waitFor(() => expect(mocks.saveFile).toHaveBeenCalledTimes(1), { timeout: 2000 });
    fireEvent.change(editor, { target: { value: 'latest draft' } });
    act(() => mocks.moves.forEach(callback => callback([{ oldPath: 'notes.md', newPath: 'renamed.md' }])));
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(mocks.saveFile).toHaveBeenCalledTimes(1);
    await act(async () => finishSave());
    await waitFor(() => expect(mocks.saveFile).toHaveBeenLastCalledWith({ path: 'renamed.md', content: 'latest draft', expectedContent: 'first draft' }));
    expect(screen.getByTestId('markdown-editor')).toHaveValue('latest draft');
  });

  it('re-reads the open markdown file in place and shows a subtle update timestamp', async () => {
    mocks.readPreview.mockResolvedValueOnce({
      name: 'notes.md',
      content: 'new content',
      size: 11,
    });
    const onExternalContentUpdated = vi.fn();

    const { container, rerender } = render(
      <FilePreviewModal
        {...baseProps}
        externalRefreshSignal={0}
        onExternalContentUpdated={onExternalContentUpdated}
      />,
    );

    expect(await screen.findByTestId('markdown-editor')).toHaveValue('old content');

    const scroller = container.querySelector('.overflow-auto') as HTMLDivElement;
    Object.defineProperty(scroller, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 500, configurable: true });
    scroller.scrollTop = 360;

    rerender(
      <FilePreviewModal
        {...baseProps}
        externalRefreshSignal={1}
        onExternalContentUpdated={onExternalContentUpdated}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('markdown-editor')).toHaveValue('new content');
    });
    expect(onExternalContentUpdated).toHaveBeenCalledWith({
      path: 'notes.md',
      name: 'notes.md',
      content: 'new content',
      size: 11,
    });
    expect(screen.getByText(/^已更新 \d{2}:\d{2}$/)).toBeTruthy();
    expect(scroller.scrollTop).toBe(360);
  });

  it('revalidates on first mount when an external refresh signal already happened', async () => {
    mocks.readPreview.mockResolvedValueOnce({
      name: 'notes.md',
      content: 'fresh after hidden update',
      size: 25,
    });

    render(
      <FilePreviewModal
        {...baseProps}
        externalRefreshSignal={3}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('markdown-editor')).toHaveValue('fresh after hidden update');
    });
    expect(mocks.readPreview).toHaveBeenCalledWith({ path: 'notes.md' });
  });

  it('does not autosave a dirty local buffer over an external update', async () => {
    mocks.readPreview.mockResolvedValueOnce({
      name: 'notes.md',
      content: 'external content',
      size: 16,
    });

    const { rerender } = render(
      <FilePreviewModal {...baseProps} initialEditMode externalRefreshSignal={0} />,
    );

    const editor = await screen.findByTestId('markdown-editor') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'local dirty content' } });

    rerender(
      <FilePreviewModal {...baseProps} initialEditMode externalRefreshSignal={1} />,
    );

    await waitFor(() => {
      expect(screen.getByText(/^外部更新 \d{2}:\d{2}$/)).toBeTruthy();
    });

    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect(editor.value).toBe('local dirty content');
    expect(mocks.saveFile).not.toHaveBeenCalled();
  });

  it('keeps the dirty editor open when closing with an external-update conflict pending', async () => {
    mocks.readPreview.mockResolvedValueOnce({
      name: 'notes.md',
      content: 'external content',
      size: 16,
    });
    const onClose = vi.fn();

    const { rerender } = render(
      <FilePreviewModal
        {...baseProps}
        onClose={onClose}
        initialEditMode
        externalRefreshSignal={0}
      />,
    );

    const editor = await screen.findByTestId('markdown-editor') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'local dirty content' } });

    rerender(
      <FilePreviewModal
        {...baseProps}
        onClose={onClose}
        initialEditMode
        externalRefreshSignal={1}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/^外部更新 \d{2}:\d{2}$/)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));

    await waitFor(() => expect(mocks.toastWarning).toHaveBeenCalledWith('文件已在外部更新，未自动覆盖'));
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.saveFile).not.toHaveBeenCalled();
    expect(editor.value).toBe('local dirty content');
  });

  it('exposes file actions from the embedded toolbar more menu', async () => {
    const onQuoteFile = vi.fn();
    const onRevealInTree = vi.fn();
    const onClose = vi.fn();
    mocks.copyPlainText.mockResolvedValueOnce(undefined);

    render(
      <FilePreviewModal
        {...baseProps}
        onClose={onClose}
        onQuoteFile={onQuoteFile}
        onRevealInTree={onRevealInTree}
      />,
    );

    fireEvent.click(screen.getByLabelText('更多'));
    expect(screen.getByRole('button', { name: '引用' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '在文件目录中展示' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制文件路径' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开所在文件夹' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重命名' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制全文' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '在文件目录中展示' }));
    expect(onRevealInTree).toHaveBeenCalledWith('notes.md');
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('更多'));
    fireEvent.click(screen.getByRole('button', { name: '复制文件路径' }));
    expect(mocks.copyPlainText).toHaveBeenCalledWith('/workspace/notes.md');
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith('已复制文件路径'));

    fireEvent.click(screen.getByLabelText('更多'));
    fireEvent.click(screen.getByRole('button', { name: '打开所在文件夹' }));
    expect(mocks.openInFinder).toHaveBeenCalledWith({ path: 'notes.md' });

    fireEvent.click(screen.getByLabelText('更多'));
    fireEvent.click(screen.getByRole('button', { name: '重命名' }));
    expect(screen.getByDisplayValue('notes.md')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByDisplayValue('notes.md'), { key: 'Escape' });
    fireEvent.click(screen.getByLabelText('更多'));
    fireEvent.click(screen.getByRole('button', { name: '引用' }));
    await waitFor(() => expect(onQuoteFile).toHaveBeenCalledWith('notes.md'));
    expect(onClose).toHaveBeenCalled();
  });

  it('copies markdown preview as rich text from the full-text menu action', async () => {
    mocks.copyMarkdownAsRichText.mockResolvedValueOnce('rich');

    render(
      <FilePreviewModal {...baseProps} content={'# Title\n\n**Body**'} />,
    );

    fireEvent.click(screen.getByLabelText('更多'));
    fireEvent.click(screen.getByRole('button', { name: '复制全文' }));

    await waitFor(() => {
      expect(mocks.copyMarkdownAsRichText).toHaveBeenCalledWith('# Title\n\n**Body**');
    });
    expect(mocks.copyPlainText).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('已复制全文');
  });

  it('copies markdown source from edit mode, including unsaved text', async () => {
    mocks.copyPlainText.mockResolvedValueOnce(undefined);

    render(
      <FilePreviewModal {...baseProps} content="# Saved" initialEditMode />,
    );

    fireEvent.click(screen.getByLabelText('更多'));
    fireEvent.click(screen.getByRole('button', { name: '源码模式' }));
    const editor = await screen.findByTestId('markdown-editor') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '# Unsaved draft' } });
    mocks.saveFile.mockClear();

    fireEvent.click(screen.getByLabelText('更多'));
    fireEvent.click(screen.getByRole('button', { name: '复制全文' }));

    await waitFor(() => {
      expect(mocks.copyPlainText).toHaveBeenCalledWith('# Unsaved draft');
    });
    expect(mocks.copyMarkdownAsRichText).not.toHaveBeenCalled();
    expect(mocks.saveFile).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('已复制全文');
  });

  it('copies non-markdown text/code files as raw text', async () => {
    mocks.copyPlainText.mockResolvedValueOnce(undefined);

    render(
      <FilePreviewModal
        {...baseProps}
        name="app.ts"
        path="app.ts"
        content="const answer = 42;"
        size={18}
      />,
    );

    const editor = await screen.findByTestId('monaco-editor') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'const answer = 43;' } });
    mocks.saveFile.mockClear();

    fireEvent.click(screen.getByLabelText('更多'));
    fireEvent.click(screen.getByRole('button', { name: '复制全文' }));

    await waitFor(() => {
      expect(mocks.copyPlainText).toHaveBeenCalledWith('const answer = 43;');
    });
    expect(mocks.copyMarkdownAsRichText).not.toHaveBeenCalled();
    expect(mocks.saveFile).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('已复制全文');
  });

  it('copies read-only text previews as raw text', async () => {
    mocks.copyPlainText.mockResolvedValueOnce(undefined);

    render(
      <FilePreviewModal
        {...baseProps}
        name="README.txt"
        path="README.txt"
        content="read-only text"
        size={14}
        workspacePath={null}
      />,
    );

    fireEvent.click(screen.getByLabelText('更多'));
    fireEvent.click(screen.getByRole('button', { name: '复制全文' }));

    await waitFor(() => {
      expect(mocks.copyPlainText).toHaveBeenCalledWith('read-only text');
    });
    expect(mocks.copyMarkdownAsRichText).not.toHaveBeenCalled();
    expect(mocks.saveFile).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('已复制全文');
  });

  it('passes the saved baseline to autosave and converts stale-save failures into external-update pending', async () => {
    mocks.saveFile.mockRejectedValueOnce(new Error('File changed externally'));
    mocks.readPreview.mockResolvedValueOnce({
      name: 'notes.md',
      content: 'external content',
      size: 16,
    });

    render(
      <FilePreviewModal {...baseProps} initialEditMode externalRefreshSignal={0} />,
    );

    const editor = await screen.findByTestId('markdown-editor') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'local dirty content' } });

    await waitFor(() => {
      expect(mocks.saveFile).toHaveBeenCalledWith({
        path: 'notes.md',
        content: 'local dirty content',
        expectedContent: 'old content',
      });
    }, { timeout: 1500 });

    await waitFor(() => {
      expect(screen.getByText(/^外部更新 \d{2}:\d{2}$/)).toBeTruthy();
    });
    expect(editor.value).toBe('local dirty content');
  });

  it('keeps the document and conflict while entering fullscreen', async () => {
    mocks.readPreview.mockResolvedValueOnce({
      name: 'notes.md',
      content: 'external content',
      size: 16,
    });
    const onFullscreen = vi.fn();

    const { rerender } = render(
      <FilePreviewModal
        {...baseProps}
        initialEditMode
        externalRefreshSignal={0}
        onFullscreen={onFullscreen}
      />,
    );

    const editor = await screen.findByTestId('markdown-editor') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'local dirty content' } });

    rerender(
      <FilePreviewModal
        {...baseProps}
        initialEditMode
        externalRefreshSignal={1}
        onFullscreen={onFullscreen}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/^外部更新 \d{2}:\d{2}$/)).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('全屏预览'));

    expect(onFullscreen).not.toHaveBeenCalled();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('markdown-editor')).toHaveValue('local dirty content');
  });
});

describe('FilePreviewModal live reload helpers', () => {
  it('formats update time as HH:mm', () => {
    expect(formatFilePreviewUpdateTime(new Date(2026, 5, 6, 3, 4))).toBe('03:04');
  });

  it('does not overwrite dirty editable content on external reload', () => {
    expect(decideLiveReload({
      incomingContent: 'external',
      currentContent: 'local dirty',
      savedContent: 'old saved',
      canEdit: true,
    })).toBe('pending');
  });

  it('applies external content when the visible buffer is clean', () => {
    expect(decideLiveReload({
      incomingContent: 'external',
      currentContent: 'old saved',
      savedContent: 'old saved',
      canEdit: true,
    })).toBe('apply');
  });
});
