import { useEffect, useRef } from 'react';
import { getSessionCronTask, isTaskExecuting } from '@/api/cronTaskClient';
import type { CronTask } from '@/types/cronTask';
import { isTauriEnvironment } from '@/utils/browserMock';
import { isPendingSessionId } from '../../shared/constants';

/** Hydrate only the current Chat's Task projection; Rust owns scheduler recovery. */
export function useSessionCronRestore({
  sessionId,
  tabId,
  task,
  onRestore,
  onClear,
}: {
  sessionId: string | null | undefined;
  tabId: string;
  task: CronTask | null;
  onRestore: (task: CronTask, executing: boolean) => void;
  onClear: () => void;
}) {
  const loadedSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId || !tabId || !isTauriEnvironment()) return;
    if (loadedSessionRef.current === sessionId) return;
    const targetSessionId = sessionId;
    let cancelled = false;

    async function hydrate() {
      try {
        const snapshot = await getSessionCronTask(targetSessionId);
        if (cancelled) return;
        if (snapshot?.status === 'running') {
          const executing = await isTaskExecuting(snapshot.id);
          if (cancelled) return;
          // Commit together after both reads. Restoring the task may rerender
          // Chat and clean up this effect; no async writes follow that commit.
          loadedSessionRef.current = targetSessionId;
          onRestore(snapshot, executing);
        } else {
          loadedSessionRef.current = targetSessionId;
          if (task?.sessionId && task.sessionId !== sessionId) {
            const isSessionUpgrade =
              isPendingSessionId(task.sessionId) && !isPendingSessionId(targetSessionId);
            if (!isSessionUpgrade) onClear();
          }
        }
      } catch (error) {
        if (!cancelled) console.error('[Chat] Failed to load cron task state:', error);
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [sessionId, tabId, task, onRestore, onClear]);
}
