export type PermissionQueueItem = {
    requestId: string;
    queuePosition?: number;
    queueTotal?: number;
};

function nextQueuePosition<T extends PermissionQueueItem>(queue: readonly T[]): number {
    return queue.reduce((max, item, index) => Math.max(max, item.queuePosition ?? index + 1), 0) + 1;
}

function normalizeQueueTotal<T extends PermissionQueueItem>(queue: readonly T[]): T[] {
    if (queue.length === 0) return [];
    const total = queue.reduce(
        (max, item, index) => Math.max(max, item.queueTotal ?? 0, item.queuePosition ?? index + 1),
        queue.length,
    );
    return queue.map(item => ({ ...item, queueTotal: total }));
}

export function enqueuePermissionRequest<T extends PermissionQueueItem>(
    queue: readonly T[],
    request: T,
): T[] {
    const existingIndex = queue.findIndex(item => item.requestId === request.requestId);
    if (existingIndex === -1) {
        return normalizeQueueTotal([
            ...queue,
            {
                ...request,
                queuePosition: request.queuePosition ?? nextQueuePosition(queue),
            },
        ]);
    }

    const next = [...queue];
    next[existingIndex] = {
        ...request,
        queuePosition: request.queuePosition ?? next[existingIndex].queuePosition,
        queueTotal: request.queueTotal ?? next[existingIndex].queueTotal,
    };
    return normalizeQueueTotal(next);
}

export function removePermissionRequest<T extends PermissionQueueItem>(
    queue: readonly T[],
    requestId: string | null | undefined,
): T[] {
    if (!requestId) return [...queue];
    return normalizeQueueTotal(queue.filter(item => item.requestId !== requestId));
}

export function peekPermissionRequest<T extends PermissionQueueItem>(
    queue: readonly T[],
): T | null {
    return queue[0] ?? null;
}
