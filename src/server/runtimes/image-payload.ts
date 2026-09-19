import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'fs';
import { dirname, isAbsolute, relative } from 'path';
import { randomUUID } from 'crypto';

import { USER_IMAGE_ATTACHMENT_MAX_BYTES } from '../../shared/fileTypes';
import { isPendingSessionId } from '../../shared/constants';
import { getAttachmentPath, saveAttachment } from '../SessionStore';
import type { ImagePayload, ResolvedImagePayload } from './types';
import { isAttachmentRefImagePayload, isInlineImagePayload } from './types';

export interface UserImageMessageAttachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  relativePath: string;
  isImage: true;
}

export function messageAttachmentsFromImagePayloads(
  sessionId: string,
  images: ImagePayload[] | undefined,
): UserImageMessageAttachment[] {
  if (!images || images.length === 0) return [];
  const attachments: UserImageMessageAttachment[] = [];
  for (const img of images) {
    if (isAttachmentRefImagePayload(img)) {
      validateAttachmentRelativePath(img.relativePath, sessionId);
      attachments.push({
        id: img.id || randomUUID(),
        name: img.name,
        size: img.sizeBytes ?? 0,
        mimeType: img.mimeType,
        relativePath: img.relativePath,
        isImage: true,
      });
      continue;
    }
    if (!isInlineImagePayload(img)) continue;
    const size = assertInlineImageSize(img.name, img.data);
    // Keep the renderer's logical identity for live preview reconciliation,
    // while retaining a server-generated storage name for untrusted ingress.
    const storageId = randomUUID();
    const attachmentId = img.id || storageId;
    const relativePath = saveAttachment(sessionId, storageId, img.name, img.data, img.mimeType);
    attachments.push({
      id: attachmentId,
      name: img.name,
      size,
      mimeType: img.mimeType,
      relativePath,
      isImage: true,
    });
  }
  return attachments;
}

export function resolveImagePayloads(
  sessionId: string,
  images: ImagePayload[] | undefined,
): ResolvedImagePayload[] | undefined {
  if (!images || images.length === 0) return undefined;
  return images.map((img) => resolveImagePayload(sessionId, img));
}

export function resolveImagePayload(sessionId: string, img: ImagePayload): ResolvedImagePayload {
  if (isInlineImagePayload(img)) {
    const sizeBytes = assertInlineImageSize(img.name, img.data);
    return {
      kind: 'inline_base64',
      name: img.name,
      mimeType: img.mimeType,
      data: img.data,
      sizeBytes,
    };
  }

  if (!isAttachmentRefImagePayload(img)) {
    throw new Error('Invalid image payload');
  }

  validateAttachmentRelativePath(img.relativePath, sessionId);
  const file = readAttachmentRefFile(img.relativePath, img.name);
  return {
    kind: 'inline_base64',
    name: img.name,
    mimeType: img.mimeType,
    data: file.data.toString('base64'),
    sizeBytes: file.size,
  };
}

export function rehomeImagePayloadsForSession(
  sourceSessionId: string | undefined,
  targetSessionId: string,
  images: ImagePayload[] | undefined,
): ImagePayload[] | undefined {
  if (!images || images.length === 0 || !sourceSessionId || sourceSessionId === targetSessionId) {
    return images;
  }
  if (isPendingSessionId(targetSessionId)) {
    throw new Error('Cannot move image attachments to a pending session');
  }

  let changed = false;
  const next = images.map((img) => {
    if (!isAttachmentRefImagePayload(img)) return img;

    const parsed = parseAttachmentRelativePath(img.relativePath);
    if (parsed.sessionId === targetSessionId) {
      validateAttachmentRelativePath(img.relativePath, targetSessionId);
      return img;
    }
    if (parsed.sessionId !== sourceSessionId) {
      throw new Error('Image attachment does not belong to this session');
    }
    if (!isPendingSessionId(sourceSessionId)) {
      throw new Error('Image attachment belongs to a different non-pending session');
    }

    const targetRelativePath = `${targetSessionId}/${parsed.fileName}`;
    validateAttachmentRelativePath(targetRelativePath, targetSessionId);
    copyAttachmentRefFile(img.relativePath, targetRelativePath, img.name);
    changed = true;
    return { ...img, relativePath: targetRelativePath };
  });

  return changed ? next : images;
}

function assertInlineImageSize(name: string, base64Data: string): number {
  const size = Buffer.from(base64Data, 'base64').length;
  if (size > USER_IMAGE_ATTACHMENT_MAX_BYTES) {
    throw new Error(`图片 "${name}" 超过 10MB，无法作为图片附件发送`);
  }
  return size;
}

function parseAttachmentRelativePath(relativePath: string): { sessionId: string; fileName: string } {
  const segments = relativePath.split('/');
  if (
    segments.length !== 2 ||
    segments.some((segment) =>
      !segment ||
      segment === '.' ||
      segment === '..' ||
      segment.includes('..') ||
      segment.includes('\\') ||
      Array.from(segment).some((ch) => {
        const code = ch.charCodeAt(0);
        return code < 0x20 || code === 0x7f;
      })
    )
  ) {
    throw new Error('Invalid image attachment reference');
  }
  return { sessionId: segments[0], fileName: segments[1] };
}

function validateAttachmentRelativePath(relativePath: string, expectedSessionId: string): void {
  const segments = parseAttachmentRelativePath(relativePath);
  if (segments.sessionId !== expectedSessionId) {
    throw new Error('Image attachment does not belong to this session');
  }
}

function readAttachmentRefFile(relativePath: string, name: string): { data: Buffer; size: number } {
  const root = getAttachmentPath('');
  const absolute = getAttachmentPath(relativePath);
  const leafMeta = lstatSync(absolute);
  if (leafMeta.isSymbolicLink()) {
    throw new Error(`Image attachment "${name}" is a symlink`);
  }
  if (!leafMeta.isFile()) {
    throw new Error(`Image attachment "${name}" is not a regular file`);
  }
  const rootCanonical = realpathSync(root);
  const canonical = realpathSync(absolute);
  const relFromRoot = relative(rootCanonical, canonical);
  if (relFromRoot.startsWith('..') || isAbsolute(relFromRoot)) {
    throw new Error(`Image attachment "${name}" escapes attachment storage`);
  }

  const fd = openSync(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const fileMeta = fstatSync(fd);
    if (!fileMeta.isFile()) {
      throw new Error(`Image attachment "${name}" is not a regular file`);
    }
    if (fileMeta.size > USER_IMAGE_ATTACHMENT_MAX_BYTES) {
      throw new Error(`图片 "${name}" 超过 10MB，无法作为图片附件发送`);
    }
    return { data: readFileSync(fd), size: fileMeta.size };
  } finally {
    closeSync(fd);
  }
}

function copyAttachmentRefFile(sourceRelativePath: string, targetRelativePath: string, name: string): void {
  const file = readAttachmentRefFile(sourceRelativePath, name);
  const targetAbsolute = getAttachmentPath(targetRelativePath);
  mkdirSync(dirname(targetAbsolute), { recursive: true });
  try {
    const targetMeta = lstatSync(targetAbsolute);
    if (targetMeta.isSymbolicLink()) {
      throw new Error(`Image attachment "${name}" target is a symlink`);
    }
    if (!targetMeta.isFile()) {
      throw new Error(`Image attachment "${name}" target is not a regular file`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
  const targetFd = openSync(
    targetAbsolute,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    writeFileSync(targetFd, file.data);
  } finally {
    closeSync(targetFd);
  }
}
