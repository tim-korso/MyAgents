import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import type { ToolAttachment } from '@/types/chat';
import ToolImageAttachment from './ToolImageAttachment';

vi.mock('@/context/TabContext', () => ({
  useTabStateOptional: () => ({ sessionId: 'session-a' }),
  useTabApiOptional: () => null,
  useTabActive: () => true,
}));

vi.mock('@/utils/toolAttachment', () => ({
  useAttachmentUrl: () => ({ state: 'ready', url: 'data:image/png;base64,abc' }),
}));

afterEach(async () => {
  await i18n.changeLanguage('zh-CN');
});

const attachment: ToolAttachment = {
  kind: 'image',
  mimeType: 'image/png',
  refPath: '/api/attachment/tool/session-a/turn-a/image.png',
  savedPath: '/Users/test/.myagents/generated/tool-attachments/session-a/turn-a/image.png',
  caption: 'Generated reference image',
};

describe('ToolImageAttachment', () => {
  it('wraps the clickable image shell around the rendered image instead of a wider fixed shell', () => {
    const { container } = render(<ToolImageAttachment attachment={attachment} />);

    const shell = screen.getByRole('button');
    expect(shell).toHaveClass('inline-flex', 'max-w-full');
    expect(shell).not.toHaveClass('block', 'max-w-sm');

    const image = screen.getByRole('img');
    expect(image).toHaveClass('max-h-80', 'max-w-full', 'h-auto', 'object-contain');
    expect(image).not.toHaveClass('w-auto');

    const stack = container.firstElementChild;
    expect(stack).toHaveClass('items-start', 'max-w-full');

    const caption = screen.getByText('Generated reference image');
    expect(caption).toHaveClass('max-w-full');
    expect(caption).not.toHaveClass('max-w-sm');
  });

  it('opens the app context menu for image right-click actions', () => {
    render(<ToolImageAttachment attachment={attachment} />);

    fireEvent.contextMenu(screen.getByRole('button'));

    expect(screen.getByRole('button', { name: '复制图片' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '另存为…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制本地路径' })).toBeInTheDocument();
  });

  it('localizes image action chrome while preserving attachment caption data', async () => {
    await i18n.changeLanguage('en-US');

    render(<ToolImageAttachment attachment={attachment} />);
    fireEvent.contextMenu(screen.getByRole('button'));

    expect(screen.getByRole('button', { name: 'Copy image' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save as…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy local path' })).toBeInTheDocument();
    expect(screen.getByText('Generated reference image')).toBeInTheDocument();
  });
});
