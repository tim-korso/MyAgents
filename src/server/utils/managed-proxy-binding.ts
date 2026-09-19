import { randomUUID } from 'node:crypto';
import type { ManagedProxyBinding } from '../../shared/cliproxy';
import { cliproxySdkSystemPrompt } from '../../shared/cliproxy';
import { completeModelAliases } from '../../shared/config-types';
import type { ProviderEnv } from '../provider-types';
import { managementApi } from './management-api-client';

export class ManagedProxyError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ManagedProxyError';
  }
}

type Control = { action: 'drain' | 'stop'; operationId: string; leaseId: string; instanceGeneration: string };
type Owner = {
  binding?: ManagedProxyBinding;
  controller: AbortController;
  onDrain?: () => void;
  draining: boolean;
  pendingControl?: Control;
};
const owners = new Map<string, Owner>();
const preparedEnvs = new WeakMap<ProviderEnv, ManagedProxyBinding['modelPolicy']>();

function requireSuccess(result: Record<string, unknown>): void {
  if (result.ok === true) return;
  throw new ManagedProxyError(
    typeof result.code === 'string' ? result.code : 'binding_unavailable',
    typeof result.error === 'string' ? result.error : '托管订阅暂时不可用',
  );
}

export function validateManagedProxyBinding(value: unknown): ManagedProxyBinding {
  const binding = value as Partial<ManagedProxyBinding> | null;
  if (!binding || binding.providerId !== 'antigravity-sub'
    || typeof binding.apiKey !== 'string' || binding.apiKey.length < 32 || binding.apiKey.length > 1024
    || ![binding.instanceGeneration, binding.accountGeneration, binding.leaseId].every(
      value => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value),
    ) || typeof binding.baseUrl !== 'string' || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(binding.baseUrl)
    || Number(new URL(binding.baseUrl).port) > 65535
    || !binding.modelPolicy || typeof binding.modelPolicy.id !== 'string'
    || (binding.modelPolicy.thinking != null && typeof binding.modelPolicy.thinking !== 'boolean')
    || ![binding.modelPolicy.contextLength, binding.modelPolicy.maxOutputTokens].every(
      value => value == null || (Number.isSafeInteger(value) && value > 0),
    )) {
    throw new ManagedProxyError('binding_contract', '本地组件返回了无效连接');
  }
  return binding as ManagedProxyBinding;
}

/** The synchronous environment builder must never turn an unresolved owner
 * reference into native Anthropic authentication or accept persisted endpoints. */
export function assertManagedProviderPrepared(env: ProviderEnv | undefined): void {
  if (env?.endpointSource && !preparedEnvs.has(env)) {
    throw new ManagedProxyError('binding_required', '托管订阅必须先准备本次请求的连接');
  }
}

export function getPreparedModelPolicy(env: ProviderEnv | undefined): ManagedProxyBinding['modelPolicy'] | undefined {
  return env ? preparedEnvs.get(env) : undefined;
}

/** Preserve each one-shot's task instructions while using the same SDK mode
 * as managed main Queries. Other providers retain their custom prompt. */
export function getPreparedSdkSystemPrompt(env: ProviderEnv | undefined, prompt: string) {
  return getPreparedModelPolicy(env) ? cliproxySdkSystemPrompt(prompt) : prompt;
}

export type PreparedProvider = {
  providerEnv: ProviderEnv | undefined;
  beforeTurn(): Promise<void>;
  reportTerminal(success: boolean): Promise<void>;
  release(): Promise<void>;
};

/** One entry for persistent/pre-warmed Queries and every SDK one-shot.
 * The caller owns cancellation and releases after its SDK subprocess closes. */
export async function prepareProviderBinding(args: {
  providerEnv: ProviderEnv | undefined;
  model: string;
  controller: AbortController;
  onDrain?: () => void;
}): Promise<PreparedProvider> {
  const { providerEnv, controller } = args;
  if (!providerEnv?.endpointSource) {
    return { providerEnv, beforeTurn: async () => {}, reportTerminal: async () => {}, release: async () => {} };
  }
  if (providerEnv.providerId !== 'antigravity-sub'
    || providerEnv.endpointSource.kind !== 'cliproxy'
    || providerEnv.endpointSource.providerId !== 'antigravity-sub'
    || providerEnv.credentialSource || providerEnv.baseUrl || providerEnv.apiKey
    || providerEnv.apiProtocol !== 'anthropic') {
    throw new ManagedProxyError('binding_contract', '托管订阅配置无效');
  }
  controller.signal.throwIfAborted();
  const sidecarId = process.env.MYAGENTS_SIDECAR_ID?.trim();
  if (!sidecarId) throw new ManagedProxyError('binding_identity', '执行进程缺少身份');
  const operationId = randomUUID();
  const owner: Owner = { controller, onDrain: args.onDrain, draining: false };
  owners.set(operationId, owner);
  let released = false;
  let turnActive = false;
  let releasePromise: Promise<void> | undefined;
  const release = (): Promise<void> => {
    if (releasePromise) return releasePromise;
    released = true;
    owners.delete(operationId);
    // This request must survive cancellation of the operation it is settling.
    // Rust records cancellation even when acquire's response was lost.
    releasePromise = managementApi('/api/cliproxy/binding/release', 'POST', {
      sidecarId, operationId, ...(owner.binding ? { leaseId: owner.binding.leaseId } : {}),
    }).then(requireSuccess);
    return releasePromise;
  };
  try {
    const result = await managementApi('/api/cliproxy/binding/acquire', 'POST', {
      sidecarId, operationId, model: args.model,
    }, { timeoutMs: 90_000, parentSignal: controller.signal });
    requireSuccess(result);
    owner.binding = validateManagedProxyBinding(result.binding);
    if (owner.binding.modelPolicy.id !== args.model) throw new ManagedProxyError('binding_contract', '组件模型与请求不匹配');
    if (owner.pendingControl) {
      if (owner.pendingControl.leaseId !== owner.binding.leaseId
        || owner.pendingControl.instanceGeneration !== owner.binding.instanceGeneration) {
        throw new ManagedProxyError('binding_contract', '组件控制消息与连接不匹配');
      }
      // No SDK child exists yet. Settlement below is sufficient; never stop
      // an unrelated Session on behalf of a request still being prepared.
      throw new ManagedProxyError('draining', '组件正在切换，请稍后重试');
    }
    controller.signal.throwIfAborted();
    const effective: ProviderEnv = {
      ...providerEnv, baseUrl: owner.binding.baseUrl, apiKey: owner.binding.apiKey, authType: 'api_key',
      modelAliases: completeModelAliases(providerEnv.modelAliases, owner.binding.modelPolicy.id),
    };
    preparedEnvs.set(effective, owner.binding.modelPolicy);
    return {
      providerEnv: effective,
      async beforeTurn() {
        controller.signal.throwIfAborted();
        if (released || owner.draining) throw new ManagedProxyError('draining', '组件正在切换，请稍后重试');
        requireSuccess(await managementApi('/api/cliproxy/binding/check', 'POST', {
          sidecarId, operationId, leaseId: owner.binding!.leaseId,
        }, { parentSignal: controller.signal }));
        turnActive = true;
      },
      async reportTerminal(success) {
        if (released || !turnActive || controller.signal.aborted) return;
        turnActive = false;
        // A best-effort product projection cannot change the SDK terminal.
        // The exact lease prevents a late result from updating another account.
        await managementApi('/api/cliproxy/binding/check', 'POST', {
          sidecarId, operationId, leaseId: owner.binding!.leaseId,
          terminal: success ? 'succeeded' : 'failed',
        }).then(requireSuccess).catch(() => console.warn('[cliproxy] Model result projection was not confirmed'));
      },
      async release() {
        preparedEnvs.delete(effective);
        await release();
      },
    };
  } catch (error) {
    await release().catch(() => {
      // Do not include endpoints or keys in diagnostics. Rust also settles
      // leases on exact Sidecar generation death.
      console.warn('[cliproxy] Binding settlement was not confirmed');
    });
    throw error;
  }
}

/** Control routes call the SessionEngine stop entry only for the exact
 * persistent Query. Auxiliary requests abort their own controller. */
export async function controlManagedProxyBinding(
  value: unknown,
  stopSession: () => Promise<void>,
): Promise<{ accepted: boolean; settled: boolean }> {
  const control = value as Partial<Control> | null;
  if (!control || (control.action !== 'drain' && control.action !== 'stop')
    || typeof control.operationId !== 'string' || typeof control.leaseId !== 'string'
    || typeof control.instanceGeneration !== 'string') return { accepted: false, settled: false };
  const owner = owners.get(control.operationId);
  // Absence proves that this Sidecar has no SDK owner for the exact operation.
  // Rust may settle its lease even if the earlier release response was lost.
  if (!owner) return { accepted: true, settled: true };
  if (!owner.binding) {
    owner.pendingControl = control as Control;
    return { accepted: true, settled: false };
  }
  if (owner.binding?.leaseId !== control.leaseId
    || owner.binding.instanceGeneration !== control.instanceGeneration) return { accepted: false, settled: false };
  const wasDraining = owner.draining;
  owner.draining = true;
  if (control.action === 'drain') {
    if (!wasDraining) owner.onDrain?.(); // One-shots finish naturally and release in finally.
  } else {
    try {
      if (owner.onDrain) await stopSession();
    } finally {
      owner.controller.abort();
    }
  }
  return { accepted: true, settled: !owners.has(control.operationId) };
}
