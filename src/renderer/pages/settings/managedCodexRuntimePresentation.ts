import {
    isManagedCodexRuntimeUsable,
    shouldAutoUpdateManagedCodexRuntime,
    type ManagedCodexRuntimeInstallState,
} from '@/config/types';

export type ManagedCodexRuntimeBusyAction = null | 'status' | 'download' | 'login' | 'logout';

export interface ManagedCodexRuntimePresentation {
    runtimeUsable: boolean;
    isUpdatingRuntime: boolean;
    showDownloadRow: boolean;
}

export type ManagedCodexUpdateRefreshAction = 'already-updating' | 'start-update' | 'no-update';

export function getManagedCodexRuntimePresentation(
    install: ManagedCodexRuntimeInstallState | undefined,
    busyAction: ManagedCodexRuntimeBusyAction,
    sharedUpdateInFlight = false,
): ManagedCodexRuntimePresentation {
    const runtimeUsable = isManagedCodexRuntimeUsable(install);
    return {
        runtimeUsable,
        isUpdatingRuntime: runtimeUsable
            && (sharedUpdateInFlight || busyAction === 'download' || install?.status === 'downloading'),
        showDownloadRow: !runtimeUsable,
    };
}

export function getManagedCodexUpdateRefreshAction(
    install: ManagedCodexRuntimeInstallState | undefined,
): ManagedCodexUpdateRefreshAction {
    if (install?.status === 'downloading') return 'already-updating';
    if (shouldAutoUpdateManagedCodexRuntime({
        managedCodexProviderDevGate: true,
        managedCodexRuntimeInstall: install,
    })) {
        return 'start-update';
    }
    return 'no-update';
}
