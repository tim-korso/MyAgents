/**
 * Path detection utility for inline code in AI output.
 *
 * Determines if a text string looks like a file or directory path,
 * so that only plausible candidates are sent to the backend for existence checks.
 */

export type InlineCodeTarget =
  | { kind: 'web'; url: string }
  | { kind: 'file'; path: string }
  | { kind: 'plain' };

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Quick, synchronous check: does `text` look like it could be a file or directory path?
 *
 * Returns `true` for plausible path candidates, `false` for obvious non-paths.
 * False positives are OK — the backend will verify existence.
 * False negatives should be minimised — we don't want to miss real paths.
 */
export function looksLikeFilePath(text: string): boolean {
  const path = text.trim();
  if (!path || path.length > 4096 || hasControlCharacter(path)) return false;
  if (/^file:\/\//i.test(path)) return true;
  // A trailing source location is not a URI scheme (README.md:12:3).
  const withoutLocation = path.replace(/:(\d+)(?::\d+)?$/, '');
  if (/^[a-z][a-z0-9+.-]*:/i.test(withoutLocation) && !/^[A-Za-z]:[\\/]/.test(path)) return false;
  // Filesystem existence, not an extension or punctuation allowlist, decides
  // whether a bounded inline token becomes a file affordance.
  return !path.includes('`') && !path.includes('${');
}

/**
 * Classify inferred inline-code targets before any action is attached.
 *
 * Explicit Markdown links already carry author intent. Backtick content does
 * not, so it is promoted only when it is a syntactically valid HTTP(S) URL or
 * a plausible file candidate whose existence will subsequently be checked by
 * FileActionContext.
 */
export function classifyInlineCodeTarget(text: string): InlineCodeTarget {
  const value = text.trim();
  if (!value) return { kind: 'plain' };

  if (!hasControlCharacter(value) && !/%(?![\da-f]{2})/i.test(value)) {
    try {
      const parsed = new URL(value);
      if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname) {
        return { kind: 'web', url: value };
      }
    } catch {
      // Fall through to file/plain classification.
    }
  }

  return looksLikeFilePath(value)
    ? { kind: 'file', path: value }
    : { kind: 'plain' };
}

/**
 * Shorten a path for display purposes only.
 * Replaces common macOS / Windows user profile prefixes with `~/`.
 *
 * This is purely cosmetic — never use the returned value for file operations.
 */
export function shortenPathForDisplay(path: string): string {
  if (!path) return path;
  // macOS: /Users/<username>/... → ~/...
  const normalized = path.replace(/\\/g, '/');
  const macMatch = normalized.match(/^\/Users\/[^/]+\/(.*)/);
  if (macMatch) return `~/${macMatch[1]}`;
  // Windows: C:\Users\<username>\... / C:/Users/<username>/... → ~/...
  const windowsMatch = normalized.match(/^[A-Za-z]:\/Users\/[^/]+\/(.*)/);
  if (windowsMatch) return `~/${windowsMatch[1]}`;
  return path;
}
