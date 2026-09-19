import { invoke } from '@tauri-apps/api/core';

import { parseModelsResponse, type DiscoveredModel } from './modelDiscoveryService';

export interface GrokAuthError {
  code: string;
  message: string;
  httpStatus?: number;
  retryable?: boolean;
}

export interface GrokAccountSummary {
  email?: string;
  displayName?: string;
}

export interface GrokAuthStatus {
  state: string;
  hasGrant: boolean;
  verified: boolean;
  account?: GrokAccountSummary;
  verifiedAt?: string;
  lastError?: GrokAuthError;
}

export interface GrokDeviceLoginView {
  sessionId: string;
  status: 'waiting' | 'validating' | 'succeeded' | 'cancelled' | 'expired' | 'error';
  userCode?: string;
  verificationUri?: string;
  verificationUriComplete?: string;
  expiresAt: number;
  pollIntervalSeconds: number;
  account?: GrokAccountSummary;
  error?: GrokAuthError;
}

export interface GrokVerificationResult {
  success: boolean;
  state: string;
  model?: string;
  account?: GrokAccountSummary;
  error?: GrokAuthError;
}

export const getGrokAuthStatus = (): Promise<GrokAuthStatus> =>
  invoke<GrokAuthStatus>('cmd_grok_auth_status');

export const startGrokLogin = (): Promise<GrokDeviceLoginView> =>
  invoke<GrokDeviceLoginView>('cmd_grok_login_start');

export const getGrokLoginStatus = (sessionId: string): Promise<GrokDeviceLoginView> =>
  invoke<GrokDeviceLoginView>('cmd_grok_login_status', { sessionId });

export const cancelGrokLogin = (sessionId: string): Promise<void> =>
  invoke<void>('cmd_grok_login_cancel', { sessionId });

export const verifyGrokAccount = (): Promise<GrokVerificationResult> =>
  invoke<GrokVerificationResult>('cmd_grok_verify_account');

export const logoutGrok = (): Promise<void> => invoke<void>('cmd_grok_logout');

export async function discoverGrokModels(): Promise<DiscoveredModel[]> {
  const response = await invoke<unknown>('cmd_grok_fetch_models');
  return parseModelsResponse(response);
}
