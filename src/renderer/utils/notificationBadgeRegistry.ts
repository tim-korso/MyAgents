export type NotificationBadgeTarget =
  | { type: 'session'; sessionId: string; workspacePath?: string }
  | { type: 'task-center'; taskId?: string };

export interface NotificationBadgeItem {
  id: string;
  source: string;
  createdAt: number;
  target: NotificationBadgeTarget;
}

export interface NotificationBadgeIncrementPayload {
  id?: unknown;
  source?: unknown;
  createdAt?: unknown;
  target?: unknown;
}

export interface NotificationBadgeVisibleSurface {
  view?: string | null;
  sessionId?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeCreatedAt(value: unknown, fallbackCreatedAt: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallbackCreatedAt;
  return value;
}

function normalizeTarget(value: unknown): NotificationBadgeTarget | null {
  if (!isRecord(value)) return null;

  const type = cleanString(value.type);
  if (type === 'session') {
    const sessionId = cleanString(value.sessionId);
    if (!sessionId) return null;
    const workspacePath = cleanString(value.workspacePath);
    return workspacePath
      ? { type: 'session', sessionId, workspacePath }
      : { type: 'session', sessionId };
  }

  if (type === 'task-center') {
    const taskId = cleanString(value.taskId);
    return taskId
      ? { type: 'task-center', taskId }
      : { type: 'task-center' };
  }

  return null;
}

export function normalizeNotificationBadgeIncrementPayload(
  payload: unknown,
  fallbackId: string,
  fallbackCreatedAt: number,
): NotificationBadgeItem | null {
  const record = isRecord(payload) ? payload as NotificationBadgeIncrementPayload : {};
  const target = normalizeTarget(record.target);
  if (!target) return null;
  return {
    id: cleanString(record.id) ?? fallbackId,
    source: cleanString(record.source) ?? 'unknown',
    createdAt: normalizeCreatedAt(record.createdAt, fallbackCreatedAt),
    target,
  };
}

export function upsertNotificationBadgeItem(
  items: readonly NotificationBadgeItem[],
  item: NotificationBadgeItem,
): NotificationBadgeItem[] {
  const existingIndex = items.findIndex((current) => current.id === item.id);
  return existingIndex >= 0
    ? items.map((current, index) => index === existingIndex ? item : current)
    : [...items, item];
}

export function countNotificationBadgeItems(items: readonly NotificationBadgeItem[]): number {
  return items.length;
}

export function buildSessionNotificationBadgeCounts(
  items: readonly NotificationBadgeItem[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.target.type !== 'session') continue;
    counts.set(item.target.sessionId, (counts.get(item.target.sessionId) ?? 0) + 1);
  }
  return counts;
}

function matchesAckTarget(item: NotificationBadgeItem, target: NotificationBadgeTarget): boolean {
  if (target.type === 'session') {
    return item.target.type === 'session' && item.target.sessionId === target.sessionId;
  }

  if (target.type === 'task-center') {
    if (item.target.type !== 'task-center') return false;
    if (!target.taskId) return true;
    return item.target.taskId === target.taskId;
  }

  return false;
}

export function acknowledgeNotificationBadgeTarget(
  items: readonly NotificationBadgeItem[],
  target: NotificationBadgeTarget,
): NotificationBadgeItem[] {
  const next = items.filter((item) => !matchesAckTarget(item, target));
  return next.length === items.length ? items as NotificationBadgeItem[] : next;
}

export function isNotificationBadgeTargetVisible(
  target: NotificationBadgeTarget,
  surface: NotificationBadgeVisibleSurface | null | undefined,
): boolean {
  if (target.type === 'session') {
    return surface?.view === 'chat' && surface.sessionId === target.sessionId;
  }

  if (target.type === 'task-center') {
    return surface?.view === 'taskcenter';
  }

  return false;
}
