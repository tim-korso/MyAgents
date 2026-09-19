import {
  getManagedCodexProviderReadiness,
  type AppConfig,
} from '../../shared/config-types';
import { loadConfig, type AdminAppConfig } from './admin-config';

type ManagedCodexReadinessConfig = Pick<AppConfig,
  | 'managedCodexProviderDevGate'
  | 'disabledProviderIds'
  | 'managedCodexRuntimeInstall'
  | 'managedCodexAuth'
>;

export function isManagedCodexProviderReady(
  config: Partial<ManagedCodexReadinessConfig> | AdminAppConfig = loadConfig(),
): boolean {
  return getManagedCodexProviderReadiness(config as ManagedCodexReadinessConfig).selectable;
}

export function managedCodexNotReadyMessage(context: string): string {
  return `Managed Codex Provider is not ready for ${context}. Open 设置 → 模型供应商, enable Codex (订阅), download the pinned runtime, and log in.`;
}

export function assertManagedCodexProviderReady(
  context: string,
  config: Partial<ManagedCodexReadinessConfig> | AdminAppConfig = loadConfig(),
): void {
  if (!isManagedCodexProviderReady(config)) {
    throw new Error(managedCodexNotReadyMessage(context));
  }
}
