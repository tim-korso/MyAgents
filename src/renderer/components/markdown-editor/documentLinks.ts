/** Resolve document-relative links before handing them to existing file/web
 * routing. Keep absolute paths and fragments under their existing authority. */
export function documentHref(href: string, path: string): string | null {
  const value = href.trim();
  if (!value) return null;
  if (/^[A-Za-z]:[\\/]/.test(value) || /^(?:\/|~\/|#|\\\\)/.test(value)) return value;
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(value)?.[1].toLowerCase();
  if (scheme) return ['http', 'https', 'mailto', 'tel', 'file'].includes(scheme) ? value : null;
  const parts = path.split('/'); parts.pop();
  for (const part of value.split('/')) {
    if (part === '..') { if (!parts.length) return null; parts.pop(); }
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}
