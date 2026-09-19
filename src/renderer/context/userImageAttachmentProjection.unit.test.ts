import { describe, expect, it } from 'vitest';

import type { ImageAttachment } from '@/components/SimpleChatInput';
import type { MessageAttachment } from '@/types/chat';
import { imagePayloadForSend, mergeAttachmentPreviews } from './userImageAttachmentProjection';

function inlineImage(id: string, preview: string): ImageAttachment {
  return {
    id,
    file: {
      name: 'image.png',
      type: 'image/png',
      size: 3,
    } as File,
    preview,
    source: 'inline_base64',
  };
}

function messageAttachment(id: string, previewUrl?: string): MessageAttachment {
  return {
    id,
    name: 'image.png',
    size: 3,
    mimeType: 'image/png',
    previewUrl,
    isImage: true,
  };
}

describe('user image attachment projection', () => {
  it('carries the renderer attachment identity through inline payloads', () => {
    expect(imagePayloadForSend(inlineImage('local-image-1', 'data:image/png;base64,b25l')))
      .toMatchObject({
        kind: 'inline_base64',
        id: 'local-image-1',
        name: 'image.png',
        data: 'b25l',
      });
  });

  it('matches legacy same-name previews one-to-one instead of reusing the first image', () => {
    const merged = mergeAttachmentPreviews(
      [messageAttachment('server-1'), messageAttachment('server-2')],
      [
        messageAttachment('local-1', 'data:image/png;base64,b25l'),
        messageAttachment('local-2', 'data:image/png;base64,dHdv'),
      ],
    );

    expect(merged?.map((attachment) => attachment.previewUrl)).toEqual([
      'data:image/png;base64,b25l',
      'data:image/png;base64,dHdv',
    ]);
  });

  it('reserves exact identities before pairing a same-name legacy attachment', () => {
    const merged = mergeAttachmentPreviews(
      [messageAttachment('server-legacy'), messageAttachment('local-exact')],
      [
        messageAttachment('local-exact', 'data:image/png;base64,ZXhhY3Q='),
        messageAttachment('local-legacy', 'data:image/png;base64,bGVnYWN5'),
      ],
    );

    expect(merged?.map((attachment) => attachment.previewUrl)).toEqual([
      'data:image/png;base64,bGVnYWN5',
      'data:image/png;base64,ZXhhY3Q=',
    ]);
  });
});
