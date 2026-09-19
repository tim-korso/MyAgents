import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), revoke: vi.fn() }));
vi.mock('@/utils/browserMock', () => ({ isTauriEnvironment: () => true }));
vi.mock('@/components/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}));

import FilePreviewModal from './FilePreviewModal';

describe('external Markdown document image base', () => {
  beforeEach(() => {
    mocks.invoke.mockReset().mockResolvedValue({ name: 'chart.png', mimeType: 'image/png', data: 'AQID' });
    mocks.revoke.mockClear();
    vi.stubGlobal('__TAURI_INTERNALS__', { invoke: (cmd: string, args: unknown) => mocks.invoke(cmd, args) });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:preview-image' });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: mocks.revoke });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it.each([
    ['/Users/demo/docs/report.md', '/Users/demo/docs/./images/看山.png'],
    ['C:\\Users\\demo\\docs\\report.md', 'C:\\Users\\demo\\docs/./images/看山.png'],
    ['\\\\server\\share\\report.md', '\\\\server\\share/./images/看山.png'],
  ])('uses authoritative localPath %s through the real modal and Markdown loader', async (localPath, fullPath) => {
    const view = render(<FilePreviewModal name="report.md" path="display-name.md" localPath={localPath}
      workspacePath={null} content="![chart](./images/看山.png)" size={30} onClose={() => {}} />);
    expect(await screen.findByRole('img')).toHaveAttribute('src', 'blob:preview-image');
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('cmd_download_local_file', {
      fullPath, workspace: null,
    }));
    expect(mocks.invoke.mock.calls.some(([cmd]) => cmd === 'cmd_workspace_download_file')).toBe(false);
    view.unmount();
    expect(mocks.revoke).toHaveBeenCalledWith('blob:preview-image');
  });
});
