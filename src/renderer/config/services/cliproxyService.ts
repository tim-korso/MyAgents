import { invoke } from '@tauri-apps/api/core';
import type { CliProxyStatus } from '../../../shared/cliproxy';
import type { ModelEntity } from '../types';
import type { DiscoveredModel } from './modelDiscoveryService';

export async function getCliProxyStatus(): Promise<CliProxyStatus> {
  return invoke<CliProxyStatus>('cmd_cliproxy_status');
}
export const connectCliProxy = (): Promise<CliProxyStatus> => invoke('cmd_cliproxy_connect');
export const cancelCliProxy = (attemptId: string): Promise<CliProxyStatus> => invoke('cmd_cliproxy_cancel', { attemptId });
export const disconnectCliProxy = (): Promise<CliProxyStatus> => invoke('cmd_cliproxy_disconnect');
export const retryCliProxyCleanup = (): Promise<CliProxyStatus> => invoke('cmd_cliproxy_retry_cleanup');
export async function discoverCliProxyModels(accountGeneration: string): Promise<DiscoveredModel[]> {
  const models = await invoke<ModelEntity[]>('cmd_cliproxy_models', { accountGeneration });
  return models.map(model => ({
    id: model.model, displayName: model.modelName, contextLength: model.contextLength,
    supportsImage: model.inputModalities?.includes('image'), supportedProtocols: ['anthropic:messages'],
  }));
}

export function shouldShowCliProxyProvider(status: CliProxyStatus | null): boolean {
  return !!status && (status.policy.usable || !!status.active || !!status.candidate || !!status.cleanup);
}
