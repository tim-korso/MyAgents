import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Message as MessageType } from '@/types/chat';

vi.mock('@/context/ImagePreviewContext', () => ({ useImagePreview: () => ({ openPreview: vi.fn() }) }));
vi.mock('@/analytics', () => ({ track: vi.fn() }));
vi.mock('@/components/tools/WidgetRenderer', () => ({
  default: ({ widgetCode, isStreaming, title }: { widgetCode: string; isStreaming: boolean; title: string }) => (
    <div data-testid="widget" data-streaming={String(isStreaming)} data-title={title}>
      {widgetCode}
    </div>
  ),
}));

import Message from './Message';

const CLOSED_WIDGET = [
  'Intro',
  '',
  '<generative-ui-widget title="flow">',
  '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>',
  '</generative-ui-widget>',
  '',
  'Done',
].join('\n');

const UNCLOSED_WIDGET = [
  '<generative-ui-widget title="flow">',
  '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>',
].join('\n');

function msg(content: MessageType['content']): MessageType {
  return {
    id: 'm-widget',
    role: 'assistant',
    content,
    timestamp: new Date(),
  } as MessageType;
}

describe('Message widget rendering', () => {
  it('parses widgets from string assistant content', () => {
    render(<Message message={msg(CLOSED_WIDGET)} isLoading={false} />);

    expect(screen.getByTestId('widget')).toHaveTextContent('<svg viewBox="0 0 10 10">');
    expect(screen.getByTestId('widget')).toHaveAttribute('data-streaming', 'false');
  });

  it('finalizes an incomplete widget segment when the assistant turn is no longer loading', () => {
    render(<Message message={msg([{ type: 'text', text: UNCLOSED_WIDGET }])} isLoading={false} />);

    expect(screen.getByTestId('widget')).toHaveAttribute('data-streaming', 'false');
  });

  it('finalizes an incomplete widget from string assistant content when the turn is no longer loading', () => {
    render(<Message message={msg(UNCLOSED_WIDGET)} isLoading={false} />);

    expect(screen.getByTestId('widget')).toHaveAttribute('data-streaming', 'false');
  });

  it('keeps an incomplete widget segment in preview mode while the assistant turn is loading', () => {
    render(<Message message={msg([{ type: 'text', text: UNCLOSED_WIDGET }])} isLoading />);

    expect(screen.getByTestId('widget')).toHaveAttribute('data-streaming', 'true');
  });
});
