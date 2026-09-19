export interface PendingSessionWatch {
  watchId: string;
  watcherSessionId: string;
  watcherResumeWorkspacePath?: string;
  targetSessionId: string;
  targetLabel: string;
  targetStateAtRegistration: string;
  registeredAt: string;
}

const pendingWatches = new Map<string, PendingSessionWatch>();

export function registerPendingSessionWatch(watch: PendingSessionWatch): void {
  pendingWatches.set(watch.watchId, watch);
}

export function listPendingSessionWatches(): PendingSessionWatch[] {
  return [...pendingWatches.values()];
}

export function ackPendingSessionWatch(watchId: string): void {
  pendingWatches.delete(watchId);
}

export function clearPendingSessionWatchesForTest(): void {
  pendingWatches.clear();
}

export function pendingSessionWatchCount(): number {
  return pendingWatches.size;
}
