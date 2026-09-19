import { invoke } from '@tauri-apps/api/core';

import { atomicModifyConfig } from '@/config/services/appConfigService';
import type { AppConfig } from '@/config/types';
import { isTauriEnvironment } from '@/utils/browserMock';

const SESSION_MIGRATED_EVENT = 'fb:session-migrated';

export interface FloatingBallSessionMigratedPayload {
    oldSessionId: string;
    newSessionId: string;
    workspacePath?: string;
}

export interface FloatingBallSessionMigrationResult {
    migrated: boolean;
    notified: boolean;
}

export function migrateFloatingBallSessionConfig(
    config: AppConfig,
    oldSessionId: string | null | undefined,
    newSessionId: string | null | undefined,
): AppConfig {
    if (!oldSessionId || !newSessionId || oldSessionId === newSessionId) return config;
    if (config.floatingBallSessionId !== oldSessionId) return config;
    return {
        ...config,
        floatingBallSessionId: newSessionId,
    };
}

function shouldNotifyCompanion(config: AppConfig): boolean {
    return config.floatingBallDevGate !== false && config.floatingBallEnabled === true;
}

export async function migrateFloatingBallSessionBinding(
    oldSessionId: string | null | undefined,
    newSessionId: string | null | undefined,
): Promise<FloatingBallSessionMigrationResult> {
    if (!oldSessionId || !newSessionId || oldSessionId === newSessionId) {
        return { migrated: false, notified: false };
    }

    let payload: FloatingBallSessionMigratedPayload | null = null;
    let shouldNotify = false;

    try {
        await atomicModifyConfig((config) => {
            const next = migrateFloatingBallSessionConfig(config, oldSessionId, newSessionId);
            if (next === config) return config;
            payload = {
                oldSessionId,
                newSessionId,
                workspacePath: config.floatingBallSessionWorkspace,
            };
            shouldNotify = shouldNotifyCompanion(config);
            return next;
        });
    } catch (err) {
        console.warn('[fb] session binding migration failed:', err);
        return { migrated: false, notified: false };
    }

    if (!payload || !shouldNotify || !isTauriEnvironment()) {
        return { migrated: payload !== null, notified: false };
    }

    try {
        await invoke('cmd_fb_relay', {
            target: 'companion',
            event: SESSION_MIGRATED_EVENT,
            payload,
        });
        return { migrated: true, notified: true };
    } catch (err) {
        console.warn('[fb] session migration relay failed:', err);
        return { migrated: true, notified: false };
    }
}

export { SESSION_MIGRATED_EVENT };
