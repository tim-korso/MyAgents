import type { ImageAttachment } from './types';

export function imageAttachmentName(img: ImageAttachment): string {
  return img.name || img.file.name;
}
