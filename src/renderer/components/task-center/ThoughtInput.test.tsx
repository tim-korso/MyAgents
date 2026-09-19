import { describe, expect, it } from 'vitest';

import {
  resizeThoughtInputTextareaAndSyncMirror,
  syncThoughtInputMirrorScroll,
} from './ThoughtInput';

function fakeTextarea(options: {
  scrollHeight: number;
  scrollTop?: number;
  onHeightSet?: (height: string, textarea: Pick<HTMLTextAreaElement, 'scrollTop'>) => void;
}): Pick<HTMLTextAreaElement, 'scrollHeight' | 'scrollTop' | 'style'> {
  const textarea = {
    scrollHeight: options.scrollHeight,
    scrollTop: options.scrollTop ?? 0,
    style: {},
  } as Pick<HTMLTextAreaElement, 'scrollHeight' | 'scrollTop' | 'style'>;
  let height = '';
  Object.defineProperty(textarea.style, 'height', {
    get: () => height,
    set: (next: string) => {
      height = next;
      options.onHeightSet?.(next, textarea);
    },
  });
  return textarea;
}

function fakeMirror(): Pick<HTMLDivElement, 'style'> {
  return { style: { transform: '' } as CSSStyleDeclaration };
}

describe('ThoughtInput mirror scroll sync', () => {
  it('translates the mirror from the textarea scrollTop', () => {
    const textarea = fakeTextarea({ scrollHeight: 120, scrollTop: 36 });
    const mirror = fakeMirror();

    syncThoughtInputMirrorScroll(textarea, mirror);

    expect(mirror.style.transform).toBe('translateY(-36px)');
  });

  it('syncs after resizing so WebKit scrollTop adjustments do not leave stale mirror text', () => {
    const textarea = fakeTextarea({
      scrollHeight: 240,
      onHeightSet: (height, target) => {
        if (height === '188px') {
          target.scrollTop = 44;
        }
      },
    });
    const mirror = fakeMirror();

    resizeThoughtInputTextareaAndSyncMirror(textarea, mirror, 78, 188);

    expect(textarea.style.height).toBe('188px');
    expect(mirror.style.transform).toBe('translateY(-44px)');
  });
});
