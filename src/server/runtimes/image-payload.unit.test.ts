import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storeMock = vi.hoisted(() => ({ root: '' }));

vi.mock('../SessionStore', () => ({
  getAttachmentPath: (relativePath: string) => join(storeMock.root, relativePath),
  saveAttachment: vi.fn(),
}));

import { messageAttachmentsFromImagePayloads, rehomeImagePayloadsForSession, resolveImagePayload } from './image-payload';
import { saveAttachment } from '../SessionStore';
import type { ImagePayload } from './types';

describe('image payload attachment refs', () => {
  beforeEach(() => {
    storeMock.root = mkdtempSync(join(tmpdir(), 'myagents-image-payload-'));
    mkdirSync(storeMock.root, { recursive: true });
  });

  afterEach(() => {
    rmSync(storeMock.root, { recursive: true, force: true });
  });

  it('copies pending attachment refs into the real session and rewrites the payload', () => {
    mkdirSync(join(storeMock.root, 'pending-tab-a'), { recursive: true });
    writeFileSync(join(storeMock.root, 'pending-tab-a', 'image.png'), Buffer.from('image-bytes'));

    const images: ImagePayload[] = [{
      kind: 'attachment_ref',
      name: 'image.png',
      mimeType: 'image/png',
      relativePath: 'pending-tab-a/image.png',
      sizeBytes: 11,
    }];

    const rehomed = rehomeImagePayloadsForSession('pending-tab-a', 'session-real-a', images);

    expect(rehomed?.[0]).toMatchObject({ relativePath: 'session-real-a/image.png' });
    expect(readFileSync(join(storeMock.root, 'pending-tab-a', 'image.png')).toString()).toBe('image-bytes');
    expect(readFileSync(join(storeMock.root, 'session-real-a', 'image.png')).toString()).toBe('image-bytes');
    expect(resolveImagePayload('session-real-a', rehomed![0]!).data).toBe(Buffer.from('image-bytes').toString('base64'));
  });

  it('does not rehome attachments between two non-pending sessions', () => {
    mkdirSync(join(storeMock.root, 'session-a'), { recursive: true });
    writeFileSync(join(storeMock.root, 'session-a', 'image.png'), Buffer.from('image-bytes'));

    const images: ImagePayload[] = [{
      kind: 'attachment_ref',
      name: 'image.png',
      mimeType: 'image/png',
      relativePath: 'session-a/image.png',
      sizeBytes: 11,
    }];

    expect(() => rehomeImagePayloadsForSession('session-a', 'session-b', images))
      .toThrow('Image attachment belongs to a different non-pending session');
  });

  it('preserves distinct client identities for same-name inline images', () => {
    const attachments = messageAttachmentsFromImagePayloads('session-a', [
      {
        kind: 'inline_base64',
        id: 'local-image-1',
        name: 'image.png',
        mimeType: 'image/png',
        data: Buffer.from('first').toString('base64'),
      },
      {
        kind: 'inline_base64',
        id: 'local-image-2',
        name: 'image.png',
        mimeType: 'image/png',
        data: Buffer.from('second').toString('base64'),
      },
    ]);

    expect(attachments.map((attachment) => attachment.id)).toEqual([
      'local-image-1',
      'local-image-2',
    ]);
    const storageIds = vi.mocked(saveAttachment).mock.calls.slice(-2).map((call) => call[1]);
    expect(storageIds).toHaveLength(2);
    expect(new Set(storageIds).size).toBe(2);
    expect(storageIds).not.toContain('local-image-1');
    expect(storageIds).not.toContain('local-image-2');
  });

  it('uses the server storage identity for legacy inline payloads without an id', () => {
    const [attachment] = messageAttachmentsFromImagePayloads('session-a', [{
      kind: 'inline_base64',
      name: 'image.png',
      mimeType: 'image/png',
      data: Buffer.from('legacy').toString('base64'),
    }]);
    const storageId = vi.mocked(saveAttachment).mock.calls.at(-1)?.[1];

    expect(storageId).toBeTruthy();
    expect(attachment?.id).toBe(storageId);
  });
});
