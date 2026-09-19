/** Leaf context contract. Renderers can consume file actions without importing
 * the provider that owns and mounts their preview surfaces. */
import { createContext, useContext, useEffect } from 'react';
import type { FileActionTarget } from '@/utils/workspaceFileLinks';

export interface PathInfo {
  exists: boolean;
  type: 'file' | 'dir';
  /** Canonical local target when a reference crosses the workspace read boundary. */
  resolvedPath?: string;
  error?: string;
}

export interface FileActionMenuOptions {
  displayPath?: string;
  /** Render above the caller's host overlay when the menu is nested. */
  zIndex?: number;
  /** Lifecycle callbacks describe the standard menu surface, not its actions. */
  onOpen?: () => void;
  onClose?: () => void;
}

export interface FileActionContextValue {
  /** Last display result, retained during revalidation; null before the first result. */
  checkPath: (path: string) => PathInfo | null;
  /** Last display result for this workspace/local target, not an action authorization. */
  checkFileTarget: (target: FileActionTarget) => PathInfo | null;
  /** Register a mounted inferred target. The first consumer schedules the
   *  batched check; the last cleanup removes work that has not started. */
  subscribeFileTarget: (target: FileActionTarget) => () => void;
  /** Incremented each time the cache is updated, so consumers can re-render. */
  cacheVersion: number;
  refreshFileTarget: (target: FileActionTarget) => void;
  /** Re-check a resolved target, then open its context menu only while it is
   *  still an existing, safety-approved file/directory. */
  openFileTargetMenu: (
    x: number,
    y: number,
    target: FileActionTarget,
    options?: FileActionMenuOptions,
  ) => () => void;
  /** Execute the target's primary action. Previewable files open internally,
   *  workspace directories reveal in the tree, and unsupported targets report
   *  a non-destructive hint instead of launching an OS application. */
  openFileTarget: (
    target: FileActionTarget,
    options?: { displayPath?: string; forceExternal?: boolean },
  ) => void;
  /** Workspace root, for resolving workspace-relative paths to absolute (e.g. the
   *  inline audio play button, whose player needs an absolute path). May be null
   *  outside a workspace. */
  workspacePath: string | null;
}

export interface FileLinkActionContextValue {
  /** Claims and previews/opens a Markdown link when it targets a local file. */
  openFileLink: (href: string, options?: { forceExternal?: boolean }) => boolean;
  /** Claims and opens the shared file context menu for a Markdown local-file link. */
  openFileLinkMenu: (x: number, y: number, href: string) => boolean;
}

export const FileActionContext = createContext<FileActionContextValue | null>(null);
export const FileLinkActionContext = createContext<FileLinkActionContextValue | null>(null);

export function useFileAction(): FileActionContextValue | null {
  return useContext(FileActionContext);
}

/**
 * Mounted-consumer boundary for inferred file affordances.
 *
 * Rendering reads the cache only. Subscription and filesystem work start in
 * an effect, so abandoned/speculative renders and virtualized rows that unmount
 * before the 50 ms batch do not leak into provider-owned IO/cache state.
 */
export function useFileTargetInfo(target: FileActionTarget | null): PathInfo | null {
  const fileAction = useFileAction();
  const subscribeFileTarget = fileAction?.subscribeFileTarget;
  const scope = target?.scope;
  const path = target?.path;

  useEffect(() => {
    if (!subscribeFileTarget || !scope || !path) return;
    return subscribeFileTarget({ scope, path });
  }, [path, scope, subscribeFileTarget]);

  return fileAction && target ? fileAction.checkFileTarget(target) : null;
}

export function useFileLinkAction(): FileLinkActionContextValue | null {
  return useContext(FileLinkActionContext);
}
