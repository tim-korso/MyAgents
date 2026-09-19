import type { ImageAttachment } from '@/components/SimpleChatInput';
import type { MessageAttachment } from '@/types/chat';

function imageAttachmentName(img: ImageAttachment): string {
  return img.name || img.file.name;
}

function imageAttachmentMimeType(img: ImageAttachment): string {
  return img.mimeType || img.file.type || 'application/octet-stream';
}

function imageAttachmentSize(img: ImageAttachment): number {
  return img.sizeBytes ?? img.file.size;
}

export function imagePayloadForSend(img: ImageAttachment) {
  const name = imageAttachmentName(img);
  const mimeType = imageAttachmentMimeType(img);
  const sizeBytes = imageAttachmentSize(img);
  if (img.source === 'attachment_ref' && img.relativePath) {
    return {
      kind: 'attachment_ref' as const,
      id: img.id,
      name,
      mimeType,
      sizeBytes,
      relativePath: img.relativePath,
    };
  }
  return {
    kind: 'inline_base64' as const,
    id: img.id,
    name,
    mimeType,
    sizeBytes,
    data: img.preview.split(',')[1] ?? '',
  };
}

export function mergeAttachmentPreviews(
  attachments: MessageAttachment[] | undefined,
  previews: MessageAttachment[] | undefined,
): MessageAttachment[] | undefined {
  if (!attachments || attachments.length === 0) return previews;
  if (!previews || previews.length === 0) return attachments;

  const previewIndexesByAttachment = new Map<number, number>();
  const usedPreviewIndexes = new Set<number>();

  // Stable identity is authoritative. Resolve every exact match first so a
  // legacy fallback cannot consume a preview that belongs to a later item.
  attachments.forEach((attachment, attachmentIndex) => {
    const previewIndex = previews.findIndex((preview, index) =>
      !usedPreviewIndexes.has(index) && preview.id === attachment.id
    );
    if (previewIndex === -1) return;
    previewIndexesByAttachment.set(attachmentIndex, previewIndex);
    usedPreviewIndexes.add(previewIndex);
  });

  // Older inline payloads were re-keyed by the server. Preserve compatibility
  // with those in-flight messages by pairing equal descriptors one-to-one.
  attachments.forEach((attachment, attachmentIndex) => {
    if (previewIndexesByAttachment.has(attachmentIndex)) return;
    const previewIndex = previews.findIndex((preview, index) =>
      !usedPreviewIndexes.has(index)
      && preview.name === attachment.name
      && preview.mimeType === attachment.mimeType
    );
    if (previewIndex === -1) return;
    previewIndexesByAttachment.set(attachmentIndex, previewIndex);
    usedPreviewIndexes.add(previewIndex);
  });

  return attachments.map((att, index) => {
    const previewIndex = previewIndexesByAttachment.get(index);
    const match = previewIndex === undefined ? undefined : previews[previewIndex];
    return match?.previewUrl ? { ...att, previewUrl: match.previewUrl } : att;
  });
}
