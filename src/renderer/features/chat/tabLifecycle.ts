import type { ChatTab } from '@/features/chat/tabContract';
import type { TabLifecycleAdapter } from '@/tab-workspace/useTabCloseController';

interface ChatLifecycleDependencies {
  flushFileEdits?: (tabId: string) => Promise<boolean>;
  startBackgroundCompletion: (sessionId: string) => Promise<{ started: boolean }>;
  stopSseProxy: (tabId: string) => Promise<unknown>;
  releaseTabSession: (sessionId: string, tabId: string) => Promise<unknown>;
  stopLegacyTabSidecar: (tabId: string) => Promise<unknown>;
  notifyBackgroundContinuation: (tab: ChatTab) => void;
  log: (message: string, error?: unknown) => void;
}

export function createChatTabLifecycle({
  flushFileEdits,
  startBackgroundCompletion,
  stopSseProxy,
  releaseTabSession,
  stopLegacyTabSidecar,
  notifyBackgroundContinuation,
  log,
}: ChatLifecycleDependencies): TabLifecycleAdapter<ChatTab> {
  return {
    prepareClose: tab => flushFileEdits ? flushFileEdits(tab.id).then(saved => saved ? 'allow' : 'blocked') : 'allow',
    afterDetach: async (tab) => {
      try {
        if (tab.sessionId) {
          // Preserve the pre-module UX contract: the captured visible state
          // decides whether closing a generating Chat shows the continuation
          // notice. The async handoff receipt only owns resource cleanup and
          // must not race the user's feedback.
          if (tab.isGenerating) notifyBackgroundContinuation(tab);
          await startBackgroundCompletion(tab.sessionId);
        }
        await stopSseProxy(tab.id);
        if (tab.sessionId) {
          try {
            await releaseTabSession(tab.sessionId, tab.id);
          } catch (error) {
            log(`[App] Error releasing session sidecar for tab ${tab.id}`, error);
            void stopLegacyTabSidecar(tab.id);
          }
        } else if (tab.agentDir) {
          void stopLegacyTabSidecar(tab.id);
        }
      } catch (error) {
        log(`[App] Background cleanup error for tab ${tab.id}`, error);
      }
    },
  };
}
