import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openExternal: vi.fn(),
  copyPlainText: vi.fn().mockResolvedValue(undefined),
  openImagePreview: vi.fn(),
  checkPaths: vi.fn(),
  checkLocalPaths: vi.fn(),
  readPreview: vi.fn(),
  readLocalPreview: vi.fn(),
  downloadFile: vi.fn(),
  downloadLocalFile: vi.fn(),
  readFileAsBlobUrl: vi.fn(),
  openWithDefault: vi.fn(),
  openPathWithDefault: vi.fn(),
  openPathExternal: vi.fn(),
  onOpenMyAgentsPreview: vi.fn(),
  onRevealInTree: vi.fn(),
  toastInfo: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/utils/clipboard', () => ({ copyPlainText: mocks.copyPlainText }));

vi.mock('@/components/Toast', async () => {
  const actual = await vi.importActual<typeof import('@/components/Toast')>('@/components/Toast');
  return {
    ...actual,
    useToastOptional: () => ({ info: mocks.toastInfo, error: mocks.toastError, success: vi.fn(), warning: vi.fn() }),
  };
});

vi.mock('@/utils/openExternal', async () => {
  const actual = await vi.importActual<typeof import('@/utils/openExternal')>('@/utils/openExternal');
  return {
    ...actual,
    openExternal: mocks.openExternal,
  };
});

vi.mock('@/context/ImagePreviewContext', () => ({
  useImagePreview: () => ({ openPreview: mocks.openImagePreview }),
}));

vi.mock('@/components/FilePreviewModal', () => ({
  default: ({ path, content }: { path: string; content: string }) => (
    <output data-testid="fullscreen-file-preview">{JSON.stringify({ path, content })}</output>
  ),
}));

vi.mock('@/hooks/useWorkspaceFileService', () => ({
  useWorkspaceFileService: () => ({
    isAvailable: true,
    readPreview: mocks.readPreview,
    readLocalPreview: mocks.readLocalPreview,
    downloadFile: mocks.downloadFile,
    downloadLocalFile: mocks.downloadLocalFile,
    readFileAsBlobUrl: mocks.readFileAsBlobUrl,
    checkPaths: mocks.checkPaths,
    checkLocalPaths: mocks.checkLocalPaths,
    openWithDefault: mocks.openWithDefault,
    openPathWithDefault: mocks.openPathWithDefault,
    openPathExternal: mocks.openPathExternal,
    openInFinder: vi.fn(),
  }),
}));

import { FileActionProvider } from '@/context/FileActionContext';

import Markdown from './Markdown';

const WORKSPACE = '/Users/zhihu/Documents/project/MyAgents';

function renderMarkdown(markdown: string, onFilePreviewExternal = vi.fn()) {
  render(
    <FileActionProvider
      workspacePath={WORKSPACE}
      onFilePreviewExternal={onFilePreviewExternal}
      onRevealInTree={mocks.onRevealInTree}
    >
      <Markdown>{markdown}</Markdown>
    </FileActionProvider>,
  );
  return { onFilePreviewExternal };
}

function renderFloatingMarkdown(markdown: string) {
  render(
    <FileActionProvider
      workspacePath={WORKSPACE}
      menuProfile="floatingBall"
      onOpenMyAgentsPreview={mocks.onOpenMyAgentsPreview}
    >
      <Markdown>{markdown}</Markdown>
    </FileActionProvider>,
  );
}

function renderFullscreenMarkdown(markdown: string) {
  render(
    <FileActionProvider workspacePath={WORKSPACE}>
      <Markdown>{markdown}</Markdown>
    </FileActionProvider>,
  );
}

describe('Markdown local file links', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.openWithDefault.mockResolvedValue(undefined);
    mocks.openPathWithDefault.mockResolvedValue(undefined);
    mocks.openPathExternal.mockResolvedValue(undefined);
    mocks.checkPaths.mockResolvedValue({ results: {} });
    mocks.checkLocalPaths.mockResolvedValue({ results: {} });
    mocks.readPreview.mockResolvedValue({
      name: 'Message.tsx',
      content: 'export default function Message() {}',
      size: 36,
    });
    mocks.readLocalPreview.mockResolvedValue({
      name: 'Other.ts',
      content: 'export const other = true;',
      size: 26,
    });
    mocks.downloadFile.mockResolvedValue({
      name: 'preview.png',
      mimeType: 'image/png',
      data: 'AQID',
      size: 3,
    });
    mocks.downloadLocalFile.mockResolvedValue({
      name: 'outside.png',
      mimeType: 'image/png',
      data: 'BAUG',
      size: 3,
    });
  });

  it.each([
    ['note%3A12.md', 'note:12.md'],
    ['%23note.md', '#note.md'],
  ])('opens and right-clicks encoded bare filename %s as a local file', async (href, path) => {
    mocks.checkPaths.mockResolvedValue({ results: { [path]: { exists: true, type: 'file' } } });
    const { onFilePreviewExternal } = renderMarkdown(`[Note](${href})`);
    fireEvent.click(screen.getByRole('link', { name: 'Note' }));
    await waitFor(() => expect(onFilePreviewExternal).toHaveBeenCalledWith(expect.objectContaining({ path })));
    fireEvent.contextMenu(screen.getByRole('link', { name: 'Note' }));
    await screen.findByText('预览');
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });

  it('opens workspace absolute path links in the MyAgents file preview instead of the system default app', async () => {
    const { onFilePreviewExternal } = renderMarkdown(
      `[Message.tsx](${WORKSPACE}/src/renderer/components/Message.tsx)`,
    );
    mocks.checkPaths.mockResolvedValue({
      results: { ['src/renderer/components/Message.tsx']: { exists: true, type: 'file' } },
    });

    fireEvent.click(screen.getByRole('link', { name: 'Message.tsx' }));

    await waitFor(() => {
      expect(onFilePreviewExternal).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Message.tsx',
        path: 'src/renderer/components/Message.tsx',
        content: 'export default function Message() {}',
      }));
    });
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });

  it('preserves line suffixes from clickable file links', async () => {
    const { onFilePreviewExternal } = renderMarkdown(
      `[Message.tsx](${WORKSPACE}/src/renderer/components/Message.tsx:42)`,
    );
    mocks.checkPaths.mockResolvedValue({
      results: { ['src/renderer/components/Message.tsx']: { exists: true, type: 'file' } },
    });

    fireEvent.click(screen.getByRole('link', { name: 'Message.tsx' }));

    await waitFor(() => {
      expect(onFilePreviewExternal).toHaveBeenCalledWith(expect.objectContaining({
        path: 'src/renderer/components/Message.tsx',
        initialLineNumber: 42,
      }));
    });
  });

  it.each([
    [`file://${WORKSPACE}/src/renderer/components/Message.tsx:42`, 'src/renderer/components/Message.tsx', WORKSPACE],
    ['C:/Users/demo/work/Guide.md#L42', 'Guide.md', 'C:\\Users\\demo\\work'],
  ])('opens a supported local link %s with its line reference', async (href, path, workspace) => {
    const onFilePreviewExternal = vi.fn();
    mocks.checkPaths.mockResolvedValue({ results: { [path]: { exists: true, type: 'file' } } });
    render(<FileActionProvider workspacePath={workspace} onFilePreviewExternal={onFilePreviewExternal}>
      <Markdown>{`[Guide](${href})`}</Markdown>
    </FileActionProvider>);
    fireEvent.click(screen.getByRole('link', { name: 'Guide' }));
    await waitFor(() => expect(onFilePreviewExternal).toHaveBeenCalledWith(expect.objectContaining({
      path, initialLineNumber: 42,
    })));
  });

  it('resolves external document links against their directory on click and right-click', async () => {
    const localPath = '/Users/demo/reports/next.md';
    mocks.checkLocalPaths.mockResolvedValue({ results: { [localPath]: { exists: true, type: 'file' } } });
    const onFilePreviewExternal = vi.fn();
    render(<FileActionProvider workspacePath={WORKSPACE} onFilePreviewExternal={onFilePreviewExternal}>
      <Markdown raw basePath="/Users/demo/reports" workspacePath={null}>{'[Next](next.md)'}</Markdown>
    </FileActionProvider>);
    fireEvent.click(screen.getByRole('link', { name: 'Next' }));
    await waitFor(() => expect(onFilePreviewExternal).toHaveBeenCalledWith(expect.objectContaining({
      localPath, sourceScope: 'local',
    })));
    fireEvent.contextMenu(screen.getByRole('link', { name: 'Next' }));
    expect(await screen.findByText('预览')).toBeInTheDocument();
  });

  it('does not let a stale fullscreen read replace a newer file target', async () => {
    let resolveA!: (value: { name: string; content: string; size: number }) => void;
    let resolveB!: (value: { name: string; content: string; size: number }) => void;
    mocks.checkPaths.mockResolvedValue({
      results: {
        'notes/a.md': { exists: true, type: 'file' },
        'notes/b.md': { exists: true, type: 'file' },
      },
    });
    mocks.readPreview.mockImplementation(({ path }: { path: string }) => new Promise((resolve) => {
      if (path === 'notes/a.md') resolveA = resolve;
      if (path === 'notes/b.md') resolveB = resolve;
    }));
    renderFullscreenMarkdown('[A](notes/a.md) [B](notes/b.md)');

    fireEvent.click(screen.getByRole('link', { name: 'A' }));
    await waitFor(() => expect(mocks.readPreview).toHaveBeenCalledWith({ path: 'notes/a.md' }));
    fireEvent.click(screen.getByRole('link', { name: 'B' }));
    await waitFor(() => expect(mocks.readPreview).toHaveBeenCalledWith({ path: 'notes/b.md' }));

    resolveB({ name: 'b.md', content: 'content B', size: 9 });
    await waitFor(() => expect(screen.getByTestId('fullscreen-file-preview')).toHaveTextContent(
      JSON.stringify({ path: 'notes/b.md', content: 'content B' }),
    ));
    resolveA({ name: 'a.md', content: 'content A', size: 9 });

    await waitFor(() => expect(screen.getByTestId('fullscreen-file-preview')).toHaveTextContent(
      JSON.stringify({ path: 'notes/b.md', content: 'content B' }),
    ));
  });

  it('previews real absolute local links outside the active workspace', async () => {
    const localPath = '/Users/zhihu/Other/Other.ts';
    mocks.checkLocalPaths.mockResolvedValue({
      results: { [localPath]: { exists: true, type: 'file' } },
    });
    const { onFilePreviewExternal } = renderMarkdown(`[Other.ts](${localPath})`);

    fireEvent.click(screen.getByRole('link', { name: 'Other.ts' }));

    await waitFor(() => {
      expect(onFilePreviewExternal).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Other.ts',
        path: localPath,
        localPath,
        sourceScope: 'local',
        content: 'export const other = true;',
      }));
    });
    expect(mocks.openExternal).not.toHaveBeenCalled();
    expect(mocks.readPreview).not.toHaveBeenCalled();
  });

  it('explains that non-previewable workspace links can be opened from the right-click menu', async () => {
    renderMarkdown(`[Archive](${WORKSPACE}/dist/archive.zip)`);
    mocks.checkPaths.mockResolvedValue({
      results: { ['dist/archive.zip']: { exists: true, type: 'file' } },
    });

    fireEvent.click(screen.getByRole('link', { name: 'Archive' }));

    await waitFor(() => expect(mocks.toastInfo).toHaveBeenCalledWith(
      '暂不支持预览，可右键菜单打开',
    ));
    expect(mocks.openWithDefault).not.toHaveBeenCalled();
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });

  it('opens workspace image links in the existing fullscreen image preview without refetching a blob URL', async () => {
    mocks.checkPaths.mockResolvedValue({
      results: { ['images/preview.png']: { exists: true, type: 'file' } },
    });
    renderMarkdown(`[Preview](${WORKSPACE}/images/preview.png)`);

    fireEvent.click(screen.getByRole('link', { name: 'Preview' }));

    await waitFor(() => expect(mocks.openImagePreview).toHaveBeenCalledWith(
      'data:image/png;base64,AQID',
      'preview.png',
    ));
    expect(mocks.downloadFile).toHaveBeenCalledWith({ path: 'images/preview.png' });
    expect(mocks.readFileAsBlobUrl).not.toHaveBeenCalled();
  });

  it('opens allowed images outside the workspace in the same fullscreen image preview', async () => {
    const localPath = '/Users/zhihu/Other/outside.png';
    mocks.checkLocalPaths.mockResolvedValue({
      results: { [localPath]: { exists: true, type: 'file' } },
    });
    renderMarkdown(`[Outside](${localPath})`);

    fireEvent.click(screen.getByRole('link', { name: 'Outside' }));

    await waitFor(() => expect(mocks.openImagePreview).toHaveBeenCalledWith(
      'data:image/png;base64,BAUG',
      'outside.png',
    ));
    expect(mocks.downloadLocalFile).toHaveBeenCalledWith({
      fullPath: localPath,
      workspace: WORKSPACE,
    });
  });

  it('uses the same fullscreen image preview from the right-click menu', async () => {
    mocks.checkPaths.mockResolvedValue({
      results: { ['images/preview.png']: { exists: true, type: 'file' } },
    });
    renderMarkdown(`[Preview](${WORKSPACE}/images/preview.png)`);

    fireEvent.contextMenu(screen.getByRole('link', { name: 'Preview' }));
    fireEvent.click(await screen.findByText('预览'));

    await waitFor(() => expect(mocks.openImagePreview).toHaveBeenCalledWith(
      'data:image/png;base64,AQID',
      'preview.png',
    ));
  });

  it('reports image loading failures instead of leaving a dead click', async () => {
    mocks.checkPaths.mockResolvedValue({
      results: { ['images/broken.png']: { exists: true, type: 'file' } },
    });
    mocks.downloadFile.mockRejectedValueOnce(new Error('read failed'));
    renderMarkdown(`[Broken](${WORKSPACE}/images/broken.png)`);

    fireEvent.click(screen.getByRole('link', { name: 'Broken' }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('图片预览加载失败'));
    expect(mocks.openImagePreview).not.toHaveBeenCalled();
  });

  it('reports a file that disappeared after its link rendered', async () => {
    mocks.checkPaths.mockResolvedValue({ results: {} });
    renderMarkdown(`[Gone](${WORKSPACE}/gone.txt)`);

    fireEvent.click(screen.getByRole('link', { name: 'Gone' }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('文件不存在或无法访问'));
  });

  it('reveals a workspace directory in the file tree on primary click', async () => {
    mocks.checkPaths.mockResolvedValue({
      results: { ['src/renderer/components']: { exists: true, type: 'dir' } },
    });
    renderMarkdown(`[Components](${WORKSPACE}/src/renderer/components)`);

    fireEvent.click(screen.getByRole('link', { name: 'Components' }));

    await waitFor(() => expect(mocks.onRevealInTree).toHaveBeenCalledWith('src/renderer/components'));
    expect(mocks.openWithDefault).not.toHaveBeenCalled();
  });

  it('uses the workspace-aware system opener for an explicit Cmd/Ctrl file click', async () => {
    mocks.checkPaths.mockResolvedValue({
      results: { ['src/renderer/components/Message.tsx']: { exists: true, type: 'file' } },
    });
    renderMarkdown(`[Message.tsx](${WORKSPACE}/src/renderer/components/Message.tsx)`);

    fireEvent.click(screen.getByRole('link', { name: 'Message.tsx' }), { metaKey: true });

    await waitFor(() => expect(mocks.openWithDefault).toHaveBeenCalledWith({
      path: 'src/renderer/components/Message.tsx',
    }));
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });

  it('opens previewable workspace links through the floating-ball MyAgents preview bridge', async () => {
    renderFloatingMarkdown(
      `[Message.tsx](${WORKSPACE}/src/renderer/components/Message.tsx:42)`,
    );
    mocks.checkPaths.mockResolvedValue({
      results: { ['src/renderer/components/Message.tsx']: { exists: true, type: 'file' } },
    });

    fireEvent.click(screen.getByRole('link', { name: 'Message.tsx' }));

    await waitFor(() => {
      expect(mocks.onOpenMyAgentsPreview).toHaveBeenCalledWith(
        'src/renderer/components/Message.tsx',
        {
          displayPath: `${WORKSPACE}/src/renderer/components/Message.tsx:42`,
          initialLineNumber: 42,
        },
      );
    });
    expect(mocks.readPreview).not.toHaveBeenCalled();
    expect(mocks.openWithDefault).not.toHaveBeenCalled();
  });

  it('opens the shared file menu on right-click for workspace Markdown file links', async () => {
    mocks.checkPaths.mockResolvedValue({
      results: { ['src/renderer/components/Message.tsx']: { exists: true, type: 'file' } },
    });
    renderMarkdown(`[Message.tsx](${WORKSPACE}/src/renderer/components/Message.tsx)`);

    fireEvent.contextMenu(screen.getByRole('link', { name: 'Message.tsx' }));

    await screen.findByText('预览');
    const labels = screen.getAllByRole('button').map((b) => b.textContent);
    expect(labels).toEqual(['预览', '复制', '引用', '打开', '打开所在文件夹', '在文件目录中展示']);
  });

  it('right-clicks real local directories without offering preview', async () => {
    const localDir = '/Users/zhihu/Other';
    mocks.checkLocalPaths.mockResolvedValue({
      results: { [localDir]: { exists: true, type: 'dir' } },
    });
    renderMarkdown(`[Other](${localDir})`);

    fireEvent.contextMenu(screen.getByRole('link', { name: 'Other' }));

    await screen.findByText('复制');
    const labels = screen.getAllByRole('button').map((b) => b.textContent);
    expect(labels).toEqual(['复制', '引用', '打开', '打开所在文件夹']);
    expect(screen.queryByText('预览')).not.toBeInTheDocument();
  });  it('opens a file despite an unrelated existing text selection', async () => {
    mocks.checkPaths.mockResolvedValue({results:{'note.md':{exists:true,type:'file'}}});
    renderMarkdown('[open note](note.md)');
    const unrelated = document.createElement('p'); unrelated.textContent='unrelated selected text';document.body.append(unrelated);
    const range=document.createRange();range.selectNodeContents(unrelated);window.getSelection()!.addRange(range);
    fireEvent.click(screen.getByRole('link',{name:'open note'}));
    await waitFor(()=>expect(mocks.readPreview).toHaveBeenCalled());
    window.getSelection()!.removeAllRanges();unrelated.remove();
    fireEvent.click(screen.getByRole('link',{name:'open note'}));
    await waitFor(()=>expect(mocks.readPreview).toHaveBeenCalledTimes(1));
  });
  it('keeps an inline-code label subordinate to the explicit markdown destination', async () => {
    mocks.checkPaths.mockResolvedValue({results:{'README.md':{exists:true,type:'file'},'docs/README.md':{exists:true,type:'file'}}});
    renderMarkdown('[`README.md`](docs/README.md)');
    expect(document.querySelector('code[role="link"]')).toBeNull();
    fireEvent.click(document.querySelector('a code')!);
    await waitFor(()=>expect(mocks.readPreview).toHaveBeenCalledWith({path:'docs/README.md'}));
    expect(mocks.readPreview).not.toHaveBeenCalledWith({path:'README.md'});
  });

  it('shows the real destination icon and full hover path, then dismisses on activation', async () => {
    mocks.checkPaths.mockResolvedValue({results:{'docs/Guide.md':{exists:true,type:'file'}}});
    renderMarkdown('[查看说明](docs/Guide.md)');
    const link = screen.getByRole('link', {name:'查看说明'});
    expect(link).toHaveClass('no-underline');
    expect(link.querySelector('[data-file-icon-category]')).not.toBeNull();
    fireEvent.mouseEnter(link.parentElement!);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('docs/Guide.md');
    fireEvent.click(link);
    expect(screen.queryByRole('tooltip')).toBeNull();
    await waitFor(()=>expect(mocks.readPreview).toHaveBeenCalledWith({path:'docs/Guide.md'}));
  });
  it('resolves inline native filenames relative to the current document', async () => {
    mocks.checkPaths.mockResolvedValue({results:{'docs/plan (final)%20.md':{exists:true,type:'file'}}});
    render(<FileActionProvider workspacePath={WORKSPACE} onFilePreviewExternal={vi.fn()}>
      <Markdown basePath="docs">{'`plan (final)%20.md`'}</Markdown>
    </FileActionProvider>);
    const link = await screen.findByRole('link', {name:'plan (final)%20.md'});
    fireEvent.click(link);
    await waitFor(()=>expect(mocks.readPreview).toHaveBeenCalledWith({path:'docs/plan (final)%20.md'}));
  });
  it('routes a workspace symlink through its canonical local read capability', async () => {
    mocks.checkPaths.mockResolvedValue({results:{'linked.md':{exists:true,type:'file',resolvedPath:'/Volumes/Files/note.md'}}});
    mocks.readLocalPreview.mockResolvedValue({name:'note.md',content:'outside',size:7});
    const {onFilePreviewExternal} = renderMarkdown('[Note](linked.md)');
    fireEvent.click(screen.getByRole('link',{name:'Note'}));
    await waitFor(()=>expect(onFilePreviewExternal).toHaveBeenCalledWith(expect.objectContaining({sourceScope:'local',localPath:'/Volumes/Files/note.md'})));
    expect(mocks.readPreview).not.toHaveBeenCalled();
  });

  it.each(['README.md:12', 'README.md:12:3'])('preserves bare filename source locations through sanitization: %s', async (reference) => {
    mocks.checkPaths.mockResolvedValue({ results: { 'docs/README.md': { exists: true, type: 'file' } } });
    const preview = vi.fn();
    render(<FileActionProvider workspacePath={WORKSPACE} onFilePreviewExternal={preview}><Markdown basePath="docs">{`[Read](${reference})`}</Markdown></FileActionProvider>);
    fireEvent.click(screen.getByRole('link', { name: 'Read' }));
    await waitFor(() => expect(preview).toHaveBeenCalledWith(expect.objectContaining({ path: 'docs/README.md', initialLineNumber: 12 })));
  });
  it('opens a document-relative link outside the workspace', async () => {
    const destination = `${WORKSPACE}/docs/../../outside.md`;
    mocks.checkLocalPaths.mockResolvedValue({ results: { [destination]: { exists: true, type: 'file', resolvedPath: '/Users/zhihu/outside.md' } } });
    mocks.readLocalPreview.mockResolvedValue({ name: 'outside.md', content: 'outside', size: 7 });
    render(<FileActionProvider workspacePath={WORKSPACE} onFilePreviewExternal={vi.fn()}><Markdown basePath="docs">{'[Outside](../../outside.md)'}</Markdown></FileActionProvider>);
    fireEvent.click(screen.getByRole('link', { name: 'Outside' }));
    await waitFor(() => expect(mocks.readLocalPreview).toHaveBeenCalledWith(expect.objectContaining({ fullPath: '/Users/zhihu/outside.md' })));
  });

  it('preserves the original reference in hover after source-location normalization', async () => {
    renderMarkdown('[Read](README.md:12:3)');
    const link = screen.getByRole('link', { name: 'Read' });
    fireEvent.mouseEnter(link.parentElement!);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('README.md:12:3');
    expect(screen.getByRole('tooltip')).not.toHaveTextContent('./README');
  });
  it('uses the same unfilled code link label in a table and in prose', () => {
    renderMarkdown('[`README.md`](README.md)\n\n| File |\n| --- |\n| [`README.md`](README.md) |');
    const links = screen.getAllByRole('link', { name: 'README.md' });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.querySelector('code')!.className).toBe('font-mono');
      expect(link.querySelector('img')).toHaveStyle({ width: '1.2em', height: '1.2em' });
    }
  });

  it.each(['docs/报告 v1.md', 'docs/notes%20final.md', 'C:\\Users\\demo\\note.md'])('keeps the authored reference for hover and copying: %s', async (reference) => {
    mocks.checkPaths.mockImplementation(async ({ paths }: { paths: string[] }) => ({ results: Object.fromEntries(paths.map(path => [path, { exists: true, type: 'file' }])) }));
    mocks.checkLocalPaths.mockImplementation(async ({ paths }: { paths: string[] }) => ({ results: Object.fromEntries(paths.map(path => [path, { exists: true, type: 'file' }])) }));
    renderMarkdown(`[Read](<${reference}>)`);
    const link = screen.getByRole('link', { name: 'Read' });
    fireEvent.mouseEnter(link.parentElement!);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(reference);
    fireEvent.contextMenu(link);
    fireEvent.click(await screen.findByRole('button', { name: '复制' }));
    expect(mocks.copyPlainText).toHaveBeenCalledWith(reference);
  });

});
