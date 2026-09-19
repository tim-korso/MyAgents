const MAX_MEDIA_FILENAME_BYTES = 180;
const WINDOWS_RESERVED_BASENAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const INVALID_FILENAME_CHAR_RE = /[<>:"/\\|?*]+/g;

function stripControlChars(value: string): string {
  let out = '';
  for (const ch of value) {
    const codePoint = ch.codePointAt(0);
    if (codePoint === undefined || codePoint <= 0x1f || codePoint === 0x7f) continue;
    out += ch;
  }
  return out;
}

function truncateUtf8(value: string, maxBytes: number): string {
  let out = '';
  for (const ch of value) {
    const next = out + ch;
    if (Buffer.byteLength(next, 'utf8') > maxBytes) break;
    out = next;
  }
  return out;
}

function truncateFilenameUtf8(filename: string, maxBytes: number): string {
  if (Buffer.byteLength(filename, 'utf8') <= maxBytes) return filename;

  const dot = filename.lastIndexOf('.');
  const ext = dot > 0 ? filename.slice(dot) : '';
  const keepExt = ext && Buffer.byteLength(ext, 'utf8') <= 32;
  if (!keepExt) return truncateUtf8(filename, maxBytes) || 'file';

  const stem = filename.slice(0, dot);
  const stemBudget = Math.max(1, maxBytes - Buffer.byteLength(ext, 'utf8'));
  return `${truncateUtf8(stem, stemBudget) || 'file'}${ext}`;
}

function ensureWindowsCompatibleLeaf(filename: string): string {
  let safe = filename.replace(/[. ]+$/g, '');
  if (!safe) safe = 'file';
  if (WINDOWS_RESERVED_BASENAME_RE.test(safe)) safe = `_${safe}`;
  return safe;
}

export function sanitizeOutboundMediaFilename(filename: string | undefined): string {
  const raw = typeof filename === 'string' ? filename : '';
  const leaf = raw.replace(/\\/g, '/').split('/').pop() ?? '';
  let safe = stripControlChars(leaf.normalize('NFC'))
    .replace(INVALID_FILENAME_CHAR_RE, '_')
    .trim()
    .replace(/^\.+/, '');

  safe = ensureWindowsCompatibleLeaf(safe);
  safe = truncateFilenameUtf8(safe, MAX_MEDIA_FILENAME_BYTES);

  return ensureWindowsCompatibleLeaf(safe);
}
