import { localDate } from '../../shared/logTime';

/**
 * Clipboard images often arrive with no usable filename (`'image.png'` is the
 * browser default; some browsers send an empty string). When we fall back to
 * the workspace-file path for unsupported-modality models, those bare names
 * collide on disk and produce `image.png`, `image_1.png`, `image_2.png`...
 * which is noisy in the workspace tree and hard to recognise later.
 *
 * Stamp a timestamped filename in that case. Real drag-drops keep their
 * original names.
 */
const BARE_CLIPBOARD_NAMES = new Set(['', 'image.png', 'image.jpeg', 'image.jpg']);

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function buildTimestampName(ext: string): string {
  // Date portion reuses the project-wide `localDate()` (`shared/logTime.ts`)
  // so the user-visible date format is consistent with log filenames /
  // timestamps elsewhere. The compact HHmmss tail is local to this filename
  // scheme — no shared helper exists yet, and adding one for a single
  // call site would be over-abstraction.
  const d = new Date();
  const hms = `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
  return `image_${localDate()}_${hms}.${ext}`;
}

export function renameIfBareClipboardImage(file: File): File {
  const name = (file.name || '').trim().toLowerCase();
  if (!BARE_CLIPBOARD_NAMES.has(name)) {
    return file;
  }
  const ext = MIME_TO_EXT[file.type] ?? 'png';
  const finalName = buildTimestampName(ext);
  return new File([file], finalName, { type: file.type, lastModified: file.lastModified });
}
