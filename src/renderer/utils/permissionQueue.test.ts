import { describe, expect, it } from 'vitest';

import {
    enqueuePermissionRequest,
    peekPermissionRequest,
    removePermissionRequest,
} from './permissionQueue';

type TestPermission = {
    requestId: string;
    toolName: string;
};

describe('permissionQueue', () => {
    it('keeps multiple concurrent permission requests in FIFO order', () => {
        const queue = enqueuePermissionRequest(
            enqueuePermissionRequest([], { requestId: 'perm-1', toolName: 'Shell' }),
            { requestId: 'perm-2', toolName: 'FileEdit' },
        );

        expect(peekPermissionRequest(queue)).toEqual({
            requestId: 'perm-1',
            toolName: 'Shell',
            queuePosition: 1,
            queueTotal: 2,
        });
        expect(removePermissionRequest(queue, 'perm-1')).toEqual([
            { requestId: 'perm-2', toolName: 'FileEdit', queuePosition: 2, queueTotal: 2 },
        ]);
    });

    it('updates duplicate request ids without moving their queue position', () => {
        const queue: TestPermission[] = enqueuePermissionRequest(
            enqueuePermissionRequest([], { requestId: 'perm-1', toolName: 'Shell' }),
            { requestId: 'perm-2', toolName: 'FileEdit' },
        );

        expect(enqueuePermissionRequest(queue, { requestId: 'perm-1', toolName: 'PowerShell' })).toEqual([
            { requestId: 'perm-1', toolName: 'PowerShell', queuePosition: 1, queueTotal: 2 },
            { requestId: 'perm-2', toolName: 'FileEdit', queuePosition: 2, queueTotal: 2 },
        ]);
    });

    it('preserves batch progress when appending after the head is resolved', () => {
        const queue = enqueuePermissionRequest(
            enqueuePermissionRequest([], { requestId: 'perm-1', toolName: 'Shell' }),
            { requestId: 'perm-2', toolName: 'FileEdit' },
        );
        const afterFirst = removePermissionRequest(queue, 'perm-1');

        expect(enqueuePermissionRequest(afterFirst, { requestId: 'perm-3', toolName: 'Search' })).toEqual([
            { requestId: 'perm-2', toolName: 'FileEdit', queuePosition: 2, queueTotal: 3 },
            { requestId: 'perm-3', toolName: 'Search', queuePosition: 3, queueTotal: 3 },
        ]);
    });

    it('ignores empty removals', () => {
        const queue: TestPermission[] = [{ requestId: 'perm-1', toolName: 'Shell' }];

        expect(removePermissionRequest(queue, undefined)).toEqual(queue);
    });
});
