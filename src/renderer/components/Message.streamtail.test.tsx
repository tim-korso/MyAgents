// Regression test for the lingering streaming tail-fade (2026-05-25, /cross-bugfix).
//
// The `.md-stream-tail` leading-edge fade (Markdown rehypeStreamTail) is meant to
// soften text *while it streams onto screen*. Bug: it stayed faded on the last few
// chars after the text block was complete and the turn moved on (next tool / slow
// gap), because the gate was only `isLoading && isLastBlock`. Fix: gate on a
// message-level `streamingTextActive` flag — set when text deltas arrive, cleared on
// the text block's content-block-stop — which works for BOTH string-content and
// block-array messages (Codex review caught that string content has its own render
// path with no gate). This test pins the gate via real Markdown rendering.
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Message as MessageType } from '@/types/chat';

vi.mock('@/context/ImagePreviewContext', () => ({ useImagePreview: () => ({ openPreview: vi.fn() }) }));
vi.mock('@/analytics', () => ({ track: vi.fn() }));

import Message from './Message';

const TAIL = 'hello streaming tail with enough chars';
const STABLE_BLOCKS = [{ type: 'text', text: TAIL }] as const;

function arrayMsg(streamingTextActive: boolean): MessageType {
  return {
    id: 'm1', role: 'assistant',
    content: [{ type: 'text', text: TAIL }],
    timestamp: new Date(),
    streamingTextActive,
  } as MessageType;
}
function stringMsg(streamingTextActive: boolean): MessageType {
  return {
    id: 'm2', role: 'assistant',
    content: TAIL,
    timestamp: new Date(),
    streamingTextActive,
  } as MessageType;
}
function arrayMsgWithStableContent(streamingTextActive: boolean): MessageType {
  return {
    id: 'm3', role: 'assistant',
    content: STABLE_BLOCKS,
    timestamp: new Date(),
    streamingTextActive,
  } as unknown as MessageType;
}
const hasFade = (c: HTMLElement) => c.querySelector('.md-stream-tail') !== null;

describe('Message — streaming tail-fade gating (.md-stream-tail)', () => {
  it.each([arrayMsg, stringMsg])('mounts actions in the terminal commit without a delayed second layout', (makeMessage) => {
    const message = makeMessage(true);
    const { container, rerender } = render(<Message message={message} isLoading />);
    expect(container.querySelector('.group\\/actions')).toBeNull();
    rerender(<Message message={message} isLoading={false} />);
    expect(container.querySelector('.group\\/actions')).not.toBeNull();
  });

  it('block-array: fades while actively streaming (loading + streamingTextActive)', () => {
    const { container } = render(<Message message={arrayMsg(true)} isLoading />);
    expect(hasFade(container)).toBe(true);
  });

  it('block-array: NO fade once the text block stopped, even while still loading', () => {
    const { container } = render(<Message message={arrayMsg(false)} isLoading />);
    expect(hasFade(container)).toBe(false);
  });

  it('string-content: fades while actively streaming', () => {
    const { container } = render(<Message message={stringMsg(true)} isLoading />);
    expect(hasFade(container)).toBe(true);
  });

  it('string-content: NO fade once stopped while still loading (the slow-gap bug)', () => {
    // Codex issue #1: pure-text messages keep `content` as a string with a separate
    // render path that previously had no gate → the last chars stayed faded forever.
    const { container } = render(<Message message={stringMsg(false)} isLoading />);
    expect(hasFade(container)).toBe(false);
  });

  it('history (not loading) never fades', () => {
    expect(hasFade(render(<Message message={arrayMsg(true)} isLoading={false} />).container)).toBe(false);
    expect(hasFade(render(<Message message={stringMsg(true)} isLoading={false} />).container)).toBe(false);
  });

  it('re-renders when only streamingTextActive changes', () => {
    const { container, rerender } = render(<Message message={arrayMsgWithStableContent(true)} isLoading />);
    expect(hasFade(container)).toBe(true);

    rerender(<Message message={arrayMsgWithStableContent(false)} isLoading />);
    expect(hasFade(container)).toBe(false);
  });
});
