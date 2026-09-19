import type { RuntimeType } from '../../shared/types/runtime';
import type {
  ExternalRuntimeConfigPatch,
  RuntimeConfigCapabilities,
} from '../runtimes/types';

export type RuntimeConfigPolicySource =
  | 'desktop'
  | 'im-sync'
  | 'cron-sync'
  | 'adopt-sync'
  | 'runtime-config'
  | 'message-snapshot'
  | 'legacy-model-set'
  | 'legacy-provider-set'
  | 'legacy-permission-mode-set'
  | 'legacy-reasoning-effort-set';

export type SnapshotConfigField =
  | 'model'
  | 'provider'
  | 'permissionMode'
  | 'reasoningEffort'
  | 'mcp'
  | 'agents';

export function shouldApplySnapshotConfigUpdate(params: {
  field: SnapshotConfigField;
  source: RuntimeConfigPolicySource;
  isSnapshotted: boolean;
}): boolean {
  if (!params.isSnapshotted) return true;
  switch (params.source) {
    case 'desktop':
    case 'runtime-config':
    case 'message-snapshot':
    case 'adopt-sync':
      return true;
    default:
      return false;
  }
}

export function filterRuntimeConfigPatchForSnapshot(params: {
  patch: ExternalRuntimeConfigPatch;
  source: RuntimeConfigPolicySource;
  isSnapshotted: boolean;
}): { patch: ExternalRuntimeConfigPatch; skippedKeys: Array<keyof ExternalRuntimeConfigPatch> } {
  const next: ExternalRuntimeConfigPatch = {};
  const skippedKeys: Array<keyof ExternalRuntimeConfigPatch> = [];

  for (const key of runtimeConfigPatchKeys(params.patch)) {
    if (shouldApplySnapshotConfigUpdate({
      field: key,
      source: params.source,
      isSnapshotted: params.isSnapshotted,
    })) {
      next[key] = params.patch[key];
    } else {
      skippedKeys.push(key);
    }
  }

  return { patch: next, skippedKeys };
}

export function getDefaultExternalConfigCapabilities(runtimeType: RuntimeType): RuntimeConfigCapabilities {
  switch (runtimeType) {
    case 'codex':
      return { model: 'next_turn_state', permissionMode: 'next_turn_state', reasoningEffort: 'next_turn_state' };
    case 'gemini':
      return { model: 'live_session_rpc', permissionMode: 'live_session_rpc', reasoningEffort: 'unsupported' };
    case 'claude-code':
      return { model: 'next_turn_state', permissionMode: 'next_turn_state', reasoningEffort: 'next_turn_state' };
    default:
      return { model: 'restart_when_idle', permissionMode: 'restart_when_idle', reasoningEffort: 'restart_when_idle' };
  }
}

export function mergeRuntimeConfigPatches(
  base: ExternalRuntimeConfigPatch,
  next: ExternalRuntimeConfigPatch,
): ExternalRuntimeConfigPatch {
  return {
    ...base,
    ...(next.model !== undefined ? { model: next.model } : {}),
    ...(next.permissionMode !== undefined ? { permissionMode: next.permissionMode } : {}),
    ...(next.reasoningEffort !== undefined ? { reasoningEffort: next.reasoningEffort } : {}),
  };
}

export function runtimeConfigPatchKeys(
  patch: ExternalRuntimeConfigPatch,
): Array<keyof ExternalRuntimeConfigPatch> {
  return (['model', 'permissionMode', 'reasoningEffort'] as const).filter((key) => patch[key] !== undefined);
}

export function isExternalModelConfigNoop(
  nextModel: string,
  desiredModel: string,
  liveReportedModel: string,
  options: { allowLiveReportedModel: boolean },
): boolean {
  if (nextModel === desiredModel) return true;
  return Boolean(options.allowLiveReportedModel && liveReportedModel && nextModel === liveReportedModel);
}

export function isRuntimeConfigPatchNoopAgainstDesired(
  patch: ExternalRuntimeConfigPatch,
  current: {
    desiredModel: string;
    liveReportedModel: string;
    desiredPermissionMode: string;
    desiredReasoningEffort: string;
  },
  options: { allowLiveReportedModel: boolean },
): boolean {
  const keys = runtimeConfigPatchKeys(patch);
  if (keys.length === 0) return true;
  return keys.every((key) => {
    switch (key) {
      case 'model':
        return isExternalModelConfigNoop(patch.model ?? '', current.desiredModel, current.liveReportedModel, options);
      case 'permissionMode':
        return (patch.permissionMode ?? '') === current.desiredPermissionMode;
      case 'reasoningEffort':
        return (patch.reasoningEffort ?? '') === current.desiredReasoningEffort;
    }
  });
}

export function shouldDeferExternalConfigOperation(
  state: 'idle' | 'starting' | 'running' | 'error',
  queueLength: number,
  drainInFlight: boolean,
  finalizationInFlight: boolean,
): boolean {
  return state === 'running' || queueLength > 0 || drainInFlight || finalizationInFlight;
}
