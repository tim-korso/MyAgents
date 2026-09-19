import { normalizeWorkspacePathIdentity } from '../../shared/workspacePath';

export interface WorkspaceFileLinkTarget {
  path: string;
  initialLineNumber?: number;
}

export type FileActionTarget =
  | { scope: 'workspace'; path: string; initialLineNumber?: number }
  | { scope: 'local'; path: string; initialLineNumber?: number };

export function resolveWorkspaceFileLinkTarget(
  href: string,
  workspacePath: string | null | undefined,
): WorkspaceFileLinkTarget | null {
  const target = resolveFileLinkTarget(href, workspacePath);
  if (target?.scope !== 'workspace') return null;
  return target.initialLineNumber
    ? { path: target.path, initialLineNumber: target.initialLineNumber }
    : { path: target.path };
}

export function resolveFileLinkTarget(
  href: string,
  workspacePath: string | null | undefined,
  format: 'url' | 'native' = 'url',
): FileActionTarget | null {
  const workspace = workspacePath?.trim();
  const raw = href?.trim();
  if (!raw || raw.startsWith('#')) return null;

  const { base: hashBase, line: hashLine } = stripHashLine(raw);
  const base = format === 'url' ? hashBase.split('#')[0] : hashBase;
  // Line annotations belong to the reference syntax, not the decoded filename:
  // `report%3A12` is a file named `report:12`, while `report:12` selects line 12.
  const { path: referencePath, line: suffixLine } = stripLineSuffix(base);
  // Parse file URLs before generic URI decoding so encoded `#` / `?` remain
  // filename characters instead of being reinterpreted as URL delimiters.
  const filePath = fileUrlToPath(referencePath);
  // Protocol/fragment syntax belongs to the encoded reference too. A decoded
  // filename such as `note:12.md` or `#note.md` is an ordinary native filename.
  if (!filePath && hasUnsupportedScheme(referencePath)) return null;
  const localPath = filePath ?? (format === 'url' ? decodeUriLoose(referencePath) : referencePath);

  const initialLineNumber = suffixLine ?? hashLine;
  const relativePath = workspace && !localPath.startsWith('~/') ? toWorkspaceRelativePath(localPath, workspace) : null;
  if (relativePath) {
    return initialLineNumber
      ? { scope: 'workspace', path: relativePath, initialLineNumber }
      : { scope: 'workspace', path: relativePath };
  }

  if (localPath.startsWith('~/') || isAbsolutePath(localPath)) {
    return initialLineNumber
      ? { scope: 'local', path: localPath, initialLineNumber }
      : { scope: 'local', path: localPath };
  }

  if (workspace && !isAbsolutePath(localPath)) {
    return { scope: 'local', path: `${stripTrailingSlash(workspace)}/${localPath}`, ...(initialLineNumber ? { initialLineNumber } : {}) };
  }
  return null;
}

export function resolveFileActionTarget(
  rawPath: string,
  workspacePath: string | null | undefined,
  options?: { parseLineReference?: boolean },
): FileActionTarget | null {
  if (options?.parseLineReference || /^file:\/\//i.test(rawPath.trim())) {
    return resolveFileLinkTarget(rawPath, workspacePath, 'native');
  }

  // Structured tool `file_path` values are native filenames, not Markdown
  // references. Preserve legal POSIX names such as `report:12` / `note#L3`
  // verbatim; only inline/Markdown references opt into line parsing above.
  const path = rawPath?.trim();
  if (!path || hasUnsupportedScheme(path)) return null;
  const workspaceRelative = workspacePath ? toWorkspaceRelativePath(path, workspacePath) : null;
  if (workspaceRelative) return { scope: 'workspace', path: workspaceRelative };
  if (isAbsolutePath(path)) return { scope: 'local', path };
  return null;
}

/**
 * Resolve a (possibly workspace-relative) path to an ABSOLUTE path against the
 * given workspace root. Returns the input unchanged when it is already
 * absolute, or `null` when it is relative and no workspace is known (or the
 * relative path escapes the workspace via `..`).
 *
 * Why: model-authored chat text usually contains workspace-relative paths
 * (e.g. `myagents_files/generated_audio/tts_x.mp3`). Absolute-path-only
 * consumers — notably the audio player's `cmd_read_file_base64`, which rejects
 * any non-absolute path with "Path must be absolute" — need them resolved
 * first. Joins with `/`; Rust `PathBuf` normalizes mixed separators on Windows.
 */
export function resolveAgainstWorkspace(
  rawPath: string,
  workspacePath: string | null | undefined,
): string | null {
  const path = rawPath?.trim();
  if (!path) return null;
  if (isAbsolutePath(path)) return path;
  const workspace = workspacePath?.trim();
  if (!workspace) return null;
  const rel = normalizeRelativePath(path, isWindowsPath(workspace)); // null if it escapes
  if (!rel) return null;
  return `${stripTrailingSlash(workspace)}/${rel}`;
}

function stripHashLine(raw: string): { base: string; line?: number } {
  const hashIndex = raw.indexOf('#');
  if (hashIndex < 0) return { base: raw };

  const base = raw.slice(0, hashIndex);
  const hash = raw.slice(hashIndex + 1);
  const match = /^L(\d+)(?:-L?\d+)?$/i.exec(hash);
  const line = match ? positiveLine(match[1]) : undefined;
  return line ? { base, line } : { base: raw };
}

function stripLineSuffix(rawPath: string): { path: string; line?: number } {
  const match = /^(.*?):(\d+)(?::\d+)?$/.exec(rawPath);
  if (!match) return { path: rawPath };

  const base = match[1];
  if (!base || /^[A-Za-z]$/.test(base)) return { path: rawPath };

  const line = positiveLine(match[2]);
  return line ? { path: base, line } : { path: rawPath };
}

function positiveLine(raw: string): number | undefined {
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

/** Decode a file URL once into a native path; never use it as authorization. */
export function fileUrlToPath(raw: string): string | null {
  if (!/^file:\/\//i.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.host && url.host !== 'localhost') {
      const pathname = decodeURIComponent(url.pathname).replace(/\//g, '\\');
      return pathname ? `\\\\${url.host}${pathname}` : null;
    }
    let pathname = decodeURIComponent(url.pathname);
    if (/^\/[A-Za-z]:[/\\]/.test(pathname)) {
      pathname = pathname.slice(1).replace(/\//g, '\\');
    }
    return pathname || null;
  } catch {
    return null;
  }
}

/** Native document directory, preserving POSIX backslashes and root markers. */
export function filePathDirname(path: string): string {
  const index = isWindowsPath(path)
    ? Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
    : path.lastIndexOf('/');
  if (index < 0) return '';
  if (index === 0 || (index === 2 && /^[A-Za-z]:/.test(path))) return path.slice(0, index + 1);
  return path.slice(0, index);
}

/** Resolve a relative Markdown link at action time, keeping its DOM href intact
 * for enclosing editor navigation. The base is native; the href is URL encoded. */
export function resolveDocumentFileLink(href: string, basePath: string): string {
  if (!basePath || href.startsWith('#') || isAbsolutePath(href) || /^[a-z][a-z\d+.-]*:/i.test(href)) return href;
  const encodedBase = normalizeSlashes(basePath).split('/').map(encodeURIComponent).join('/');
  return `${encodedBase}/${href}`;
}

function hasUnsupportedScheme(raw: string): boolean {
  if (/^[A-Za-z]:[\\/]/.test(raw)) return false;
  return /^[a-z][a-z0-9+\-.]*:/i.test(raw);
}

/**
 * Normalize a path to its workspace-relative form.
 *
 * - Absolute path inside the workspace → relative (e.g.
 *   `/ws/src/a.ts` → `src/a.ts`); absolute path outside the workspace,
 *   or equal to the workspace root, → `null`.
 * - Relative path that looks like a file reference → cleaned relative; other
 *   relative inputs → `null`.
 *
 * File-tool cards (Write/Edit/Read/NotebookEdit) carry ABSOLUTE `file_path`
 * values, but the workspace existence-check + read commands only accept
 * workspace-relative paths (Rust `resolve_inside_workspace` rejects absolute
 * paths outright). Callers normalize here so absolute and relative paths flow
 * through the same backend path, matching how inline AI-text paths behave.
 */
export function toWorkspaceRelativePath(rawPath: string | null | undefined, workspacePath: string): string | null {
  // Total by construction: a path util must never throw on a missing path —
  // an uncaught throw here reaches the root error boundary and kills the whole
  // app. Callers (file-tool chips) can pass an undefined `file_path`.
  const path = rawPath?.trim();
  if (!path) return null;

  if (isAbsolutePath(path)) {
    return absoluteToWorkspaceRelative(path, workspacePath);
  }

  const windowsStyle = isWindowsPath(workspacePath);
  return normalizeRelativePath(path, windowsStyle);
}

/**
 * Resolve the path to use for backend existence checks + context-menu actions
 * from a raw path that may be absolute or workspace-relative.
 *
 * In-workspace absolute paths are normalized to workspace-relative form (the
 * Rust `resolve_inside_workspace` resolver rejects absolute paths outright);
 * everything else — relative paths, or absolute paths outside the workspace —
 * passes through unchanged so the backend reports them as not-found.
 *
 * Shared by the two surfaces that turn paths into clickable chips so they
 * resolve identically: the inline-code path detector (`markdown/InlineCode`)
 * and the file-tool chip (`tools/FilePath`). Before this was shared, only the
 * tool chip normalized — inline absolute paths in AI text silently stayed plain
 * because the absolute form was sent straight to the rejecting resolver.
 */
export function resolveActionPath(rawPath: string, workspacePath: string | null | undefined): string {
  return (workspacePath ? toWorkspaceRelativePath(rawPath, workspacePath) : null) ?? rawPath;
}

function absoluteToWorkspaceRelative(rawPath: string, rawWorkspace: string): string | null {
  const path = stripTrailingSlash(normalizeSlashes(rawPath));
  const workspace = stripTrailingSlash(normalizeSlashes(rawWorkspace));
  const comparablePath = normalizeWorkspacePathIdentity(path);
  const comparableWorkspace = normalizeWorkspacePathIdentity(workspace);

  if (comparablePath === comparableWorkspace) return null;
  const prefix = comparableWorkspace.endsWith('/') ? comparableWorkspace : `${comparableWorkspace}/`;
  if (!comparablePath.startsWith(prefix)) return null;
  return normalizeRelativePath(path.slice(prefix.length));
}

function normalizeRelativePath(rawPath: string, windowsStyle = false): string | null {
  if (isAbsolutePath(rawPath)) return null;

  const parts = (windowsStyle ? rawPath.replace(/\\/g, '/') : rawPath).split('/');
  const stack: string[] = [];

  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    stack.push(part);
  }

  return stack.length > 0 ? stack.join('/') : null;
}

function isAbsolutePath(rawPath: string): boolean {
  return rawPath.startsWith('/') || /^[/\\]{2}/.test(rawPath) || /^[A-Za-z]:[\\/]/.test(rawPath);
}

function normalizeSlashes(rawPath: string): string {
  // This is a native path boundary. Decoding here corrupts literal `%20` names
  // already decoded by the Markdown/file-URL boundary above.
  return isWindowsPath(rawPath) ? rawPath.replace(/\\/g, '/') : rawPath;
}

function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:/.test(path) || path.startsWith('\\\\') || path.startsWith('//');
}

function stripTrailingSlash(rawPath: string): string {
  const normalized = normalizeSlashes(rawPath);
  if (normalized === '/' || /^[A-Za-z]:\/$/.test(normalized)) return normalized;
  return normalized.replace(/\/+$/, '');
}

function decodeUriLoose(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
