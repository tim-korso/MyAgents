import { StrictMode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  available: true,
  createObjectURL: vi.fn(),
  revokeObjectURL: vi.fn(),
}));

vi.mock('@/utils/browserMock', () => ({ isTauriEnvironment: () => mocks.available }));
vi.mock('@/components/FilePreviewModal', () => ({ default: () => null }));
vi.mock('@/context/ImagePreviewContext', () => ({
  useImagePreview: () => ({ openPreview: vi.fn() }),
}));

import { FileActionProvider } from '@/context/FileActionContext';
import { i18n } from '@/i18n';
import Markdown from './Markdown';

const WORKSPACE = '/Users/zhihu/Documents/project/mino';
const IMAGE_PATH = `${WORKSPACE}/workspace/0908-kanshan-impact/看山_F123连续周曲线.png`;
const MARKDOWN = `![看山分人群连续周曲线](${IMAGE_PATH})`;
const FILE = { name: 'chart.png', mimeType: 'image/png', data: 'AQID' };

function imageReadError(src: string) {
  return `[${i18n.t('app:markdown.imageLoadFailed', { src })}]`;
}

function chat(content: string, workspacePath: string | null = WORKSPACE) {
  return <FileActionProvider workspacePath={workspacePath}><Markdown>{content}</Markdown></FileActionProvider>;
}

describe('Markdown local images', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.available = true;
    mocks.invoke.mockResolvedValue(FILE);
    // Keep the real service and Tauri API; only replace the native IPC boundary.
    vi.stubGlobal('__TAURI_INTERNALS__', {
      invoke: (cmd: string, args: unknown) => mocks.invoke(cmd, args),
    });
    let nextUrl = 0;
    mocks.createObjectURL.mockImplementation(() => `blob:image-${++nextUrl}`);
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: mocks.createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: mocks.revokeObjectURL });
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('loads the reported Chinese absolute path through Rust in ordinary chat', async () => {
    render(chat(MARKDOWN));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('cmd_download_local_file', {
      fullPath: IMAGE_PATH, workspace: WORKSPACE,
    }));
    expect(await screen.findByRole('img')).toHaveAttribute('src', 'blob:image-1');
    expect(screen.getByRole('img')).toHaveAttribute('alt', '看山分人群连续周曲线');
  });

  it('resolves relative chat images against the containing workspace', async () => {
    render(chat('![chart](plots/chart.png)'));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('cmd_workspace_download_file', {
      workspace: WORKSPACE, path: 'plots/chart.png',
    }));
    expect(await screen.findByRole('img')).toHaveAttribute('src', 'blob:image-1');
  });

  it('keeps the explicit document workspace and base separate from surrounding chat', async () => {
    render(<FileActionProvider workspacePath={WORKSPACE}>
      <Markdown raw basePath="docs" workspacePath="/other/workspace">{'![chart](../plots/chart.png)'}</Markdown>
    </FileActionProvider>);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('cmd_workspace_download_file', {
      workspace: '/other/workspace', path: 'docs/../plots/chart.png',
    }));
  });

  it('does not prepend the document directory to an absolute image path', async () => {
    render(<Markdown raw basePath="docs" workspacePath={WORKSPACE}>{MARKDOWN}</Markdown>);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('cmd_download_local_file', {
      fullPath: IMAGE_PATH, workspace: WORKSPACE,
    }));
  });

  it('loads an allowed absolute local path without a workspace', async () => {
    render(<Markdown>{MARKDOWN}</Markdown>);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('cmd_download_local_file', {
      fullPath: IMAGE_PATH, workspace: null,
    }));
  });

  it.each([
    ['file:///Users/demo/%E7%9C%8B%E5%B1%B1%20%2520.png', '/Users/demo/看山 %20.png'],
    ['FiLe:///Users/demo/chart.png', '/Users/demo/chart.png'],
    ['C:/Users/demo/chart.png', 'C:\\Users\\demo\\chart.png'],
    [String.raw`C:\\Users\\demo\\chart.png`, 'C:\\Users\\demo\\chart.png'],
    ['file:///C:/Users/demo/chart.png', 'C:\\Users\\demo\\chart.png'],
    ['file://server/share/chart.png', '\\\\server\\share\\chart.png'],
  ])('loads the supported local reference %s', async (reference, fullPath) => {
    render(<Markdown>{`![chart](${reference})`}</Markdown>);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('cmd_download_local_file', {
      fullPath, workspace: null,
    }));
    expect(await screen.findByRole('img')).toHaveAttribute('src', 'blob:image-1');
  });

  it('loads a relative image against an external document directory without workspace authority', async () => {
    render(<FileActionProvider workspacePath={WORKSPACE}>
      <Markdown raw basePath="/Users/demo/reports" workspacePath={null}>{'![chart](../images/看山.png)'}</Markdown>
    </FileActionProvider>);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('cmd_download_local_file', {
      fullPath: '/Users/demo/reports/../images/看山.png', workspace: null,
    }));
  });

  it('decodes spaces, Chinese, reserved characters and literal percent sequences once', async () => {
    const path = '/Users/zhihu/图 #1? %20.png';
    render(<Markdown>{`![chart](${path.split('/').map(encodeURIComponent).join('/')})`}</Markdown>);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('cmd_download_local_file', {
      fullPath: path, workspace: null,
    }));
  });

  it('leaves relative traversal intact for the Rust boundary to reject', async () => {
    mocks.invoke.mockRejectedValue(new Error('Path escapes workspace root'));
    render(<Markdown basePath="docs" workspacePath={WORKSPACE}>{'![chart](../../outside.png)'}</Markdown>);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('cmd_workspace_download_file', {
      workspace: WORKSPACE, path: 'docs/../../outside.png',
    }));
    expect(await screen.findByText(imageReadError('../../outside.png'))).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('does not refetch or revoke an unchanged image when chat text streams', async () => {
    const view = render(chat(MARKDOWN));
    await screen.findByRole('img');
    view.rerender(chat(`${MARKDOWN}\n\nMore text`));
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.revokeObjectURL).not.toHaveBeenCalled();
    view.unmount();
    expect(mocks.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:image-1');
  });

  it('revokes late results and never replaces a newer image with them', async () => {
    let resolveOld!: (file: typeof FILE) => void;
    mocks.invoke.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const view = render(chat(MARKDOWN));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    view.rerender(chat('![new](/Users/zhihu/new.png)'));
    expect(await screen.findByRole('img')).toHaveAttribute('src', 'blob:image-1');
    await act(async () => { resolveOld(FILE); });
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:image-1');
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith('blob:image-2');
  });

  it('releases all blob handles through StrictMode setup and cleanup', async () => {
    const view = render(<StrictMode>{chat(MARKDOWN)}</StrictMode>);
    await screen.findByRole('img');
    view.unmount();
    expect(mocks.createObjectURL.mock.results.length).toBeGreaterThan(0);
    for (const result of mocks.createObjectURL.mock.results) {
      expect(mocks.revokeObjectURL.mock.calls.filter(([url]) => url === result.value)).toHaveLength(1);
    }
  });

  it('shows a local read error and recovers when the image source changes', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('File not found'));
    const view = render(chat(MARKDOWN));
    expect(await screen.findByText(imageReadError(encodeURI(IMAGE_PATH)))).toBeInTheDocument();
    view.rerender(chat('![new](/Users/zhihu/new.png)'));
    expect(await screen.findByRole('img')).toHaveAttribute('src', 'blob:image-1');
    expect(screen.queryByText(imageReadError(encodeURI(IMAGE_PATH)))).not.toBeInTheDocument();
  });

  it('shows an error when local IO is unavailable instead of loading forever', async () => {
    mocks.available = false;
    render(chat(MARKDOWN));
    expect(await screen.findByText(imageReadError(encodeURI(IMAGE_PATH)))).toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('does not borrow the chat workspace when a preview explicitly supplies null', () => {
    render(<FileActionProvider workspacePath={WORKSPACE}>
      <Markdown basePath="" workspacePath={null}>{'![chart](chart.png)'}</Markdown>
    </FileActionProvider>);
    expect(screen.getByText(imageReadError('chart.png'))).toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('preserves remote URLs and keeps unsafe schemes sanitized', () => {
    render(chat('![remote](https://example.com/chart.png)\n\n![cdn](//example.com/chart.png)\n\n![bad](javascript:alert%281%29)'));
    expect(screen.getByRole('img', { name: 'remote' })).toHaveAttribute('src', 'https://example.com/chart.png');
    expect(screen.getByRole('img', { name: 'cdn' })).toHaveAttribute('src', '//example.com/chart.png');
    expect(screen.queryByRole('img', { name: 'bad' })).not.toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('uses the same loader for sanitized HTML images', async () => {
    render(chat(`<img src="${IMAGE_PATH}" alt="chart" onload="alert(1)">`));
    const img = await screen.findByRole('img');
    expect(img).toHaveAttribute('src', 'blob:image-1');
    expect(img).not.toHaveAttribute('onload');
  });

  it('reloads a relative source when its enclosing workspace changes', async () => {
    const view = render(chat('![chart](plots/chart.png)'));
    await screen.findByRole('img');
    view.rerender(chat('![chart](plots/chart.png)', '/other/workspace'));
    await waitFor(() => expect(mocks.invoke).toHaveBeenLastCalledWith('cmd_workspace_download_file', {
      workspace: '/other/workspace', path: 'plots/chart.png',
    }));
    await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:image-2'));
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith('blob:image-1');
  });
});
