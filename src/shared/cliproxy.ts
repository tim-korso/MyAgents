import type { ModelEntity } from './config-types';

export const CLIPROXY_VERIFICATION_PROMPT = 'Verify the connected model using the supplied connection tool. Follow the verification instructions exactly.';

/** Match the existing main Query's supported SDK preset+append mode. The
 * SDK's no-append identity is a different upstream request, even with a custom
 * system prompt. Keep verification and auxiliary requests on the tested mode. */
export function cliproxySdkSystemPrompt(append: string) {
  if (!append.trim()) throw new Error('CLIProxy SDK requests require a task-specific prompt append');
  return { type: 'preset' as const, preset: 'claude_code' as const, append };
}

/** Product views contain no endpoint, local key, OAuth state or credential path. */
export type CliProxyError = { code: string; message: string };
export type CliProxyAccount = {
  generation: string;
  email?: string | null;
  status: 'connected' | 'reauth-required';
  error?: CliProxyError | null;
};
export type CliProxyCandidate = {
  attemptId: string;
  generation: string;
  phase: 'authorizing' | 'stored' | 'authorized' | 'waiting-to-commit' | 'cancelling' | 'failed';
  email?: string | null;
  expiresAt?: string | null;
  error?: CliProxyError | null;
};
export type CliProxyStatus = {
  policy: { mode: 'disabled' | 'internal' | 'enabled'; usable: boolean; revision: number; error?: CliProxyError | null;
    validity?: 'valid' | 'missing' | 'invalid' | 'incompatible'; source?: 'bundled' | 'cached' | 'remote' };
  component: { version?: string | null; previousVersion?: string | null; bundledVersion?: string;
    phase?: 'missing' | 'installing' | 'installed' | 'failed'; source?: 'bundled' | 'updated' | null };
  update: {
    phase: 'idle' | 'checking' | 'downloading' | 'installing' | 'ready' | 'waiting-to-switch' | 'failed';
    targetVersion?: string | null;
    downloadedBytes?: number;
    totalBytes?: number;
    lastCheckedAt?: string | null;
    error?: CliProxyError | null;
  };
  active?: CliProxyAccount | null;
  candidate?: CliProxyCandidate | null;
  instances: { active: string; candidate: string; activeGeneration?: string | null; candidateGeneration?: string | null };
  cleanup?: { scope: 'candidate' | 'retired' | 'all'; failed: boolean } | null;
  models: ModelEntity[];
  modelsStale: boolean;
  error?: CliProxyError | null;
};

/** Execution-only protocol between an identified Sidecar generation and Rust. */
export type ManagedProxyBinding = {
  providerId: 'antigravity-sub';
  baseUrl: string;
  apiKey: string;
  instanceGeneration: string;
  accountGeneration: string;
  leaseId: string;
  /** Native model metadata; absence does not prevent an upstream request. */
  modelPolicy: { id: string; thinking?: boolean | null; contextLength?: number | null; maxOutputTokens?: number | null };
};
