import { useEffect, useRef, useState } from 'react';

import { normalizeWorkspacePathIdentity } from '../../shared/workspacePath';

export const INTRODUCTION_FILE_PATH = 'INTRODUCTION.md';

export type IntroductionReader = (relativePath: string) => Promise<string | null>;

export function normalizeIntroductionContent(content: string | null): string | null {
  return content && content.trim() ? content : null;
}

export function isIntroductionAbsentError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('File not found')
    || message.includes('Not a regular file')
    || message.includes('File type not supported')
    || message.includes('File too large to preview')
    || message.includes('File is not valid UTF-8');
}

export function shouldShowIntroductionOverlay({
  content,
  historyMessageCount,
  hasStreamingMessage,
  isSessionLoading,
  isLoading,
  sessionState,
  showStartupOverlay,
}: {
  content: string | null;
  historyMessageCount: number;
  hasStreamingMessage: boolean;
  isSessionLoading: boolean;
  isLoading: boolean;
  sessionState: string;
  showStartupOverlay: boolean;
}): boolean {
  return Boolean(content)
    && historyMessageCount === 0
    && !hasStreamingMessage
    && !isSessionLoading
    && !isLoading
    && sessionState === 'idle'
    && !showStartupOverlay;
}

export function useIntroductionContent(
  agentDir: string | undefined,
  refreshKey: number,
  readFile: IntroductionReader,
): string | null {
  const [loadedContent, setLoadedContent] = useState<{ workspaceKey: string; content: string | null } | null>(null);
  const activeWorkspaceKeyRef = useRef<string | null>(null);
  const currentWorkspaceKey = agentDir ? normalizeWorkspacePathIdentity(agentDir) : null;

  useEffect(() => {
    if (!currentWorkspaceKey) {
      activeWorkspaceKeyRef.current = null;
      return;
    }

    activeWorkspaceKeyRef.current = currentWorkspaceKey;
    let cancelled = false;
    readFile(INTRODUCTION_FILE_PATH)
      .then((nextContent) => {
        if (!cancelled && activeWorkspaceKeyRef.current === currentWorkspaceKey) {
          const normalizedContent = normalizeIntroductionContent(nextContent);
          setLoadedContent((prev) => (
            prev?.workspaceKey === currentWorkspaceKey && prev.content === normalizedContent
              ? prev
              : { workspaceKey: currentWorkspaceKey, content: normalizedContent }
          ));
        }
      })
      .catch(() => {
        if (!cancelled && activeWorkspaceKeyRef.current === currentWorkspaceKey) {
          setLoadedContent((prev) => (
            prev?.workspaceKey === currentWorkspaceKey
              ? prev
              : { workspaceKey: currentWorkspaceKey, content: null }
          ));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentWorkspaceKey, refreshKey, readFile]);

  return loadedContent?.workspaceKey === currentWorkspaceKey ? loadedContent.content : null;
}
