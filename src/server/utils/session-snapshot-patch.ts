import type { SessionMetadata } from '../types/session';
import { getDefaultRuntimePermissionMode, type RuntimeType } from '../../shared/types/runtime';
import { isConcreteProviderRoute } from '../../shared/providerRoute';

type SessionSnapshotPatchKey =
  | 'model'
  | 'reasoningEffort'
  | 'permissionMode'
  | 'mcpEnabledServers'
  | 'enabledPluginIds'
  | 'enabledOfficialToolIds'
  | 'providerId'
  | 'providerRoute'
  | 'providerExecutionIdentity'
  | 'providerEnvJson';

export type SessionSnapshotPatchPayload = {
  [K in SessionSnapshotPatchKey]?: SessionMetadata[K] | null;
};

const SNAPSHOT_KEYS = [
  'model',
  'reasoningEffort',
  'permissionMode',
  'mcpEnabledServers',
  'enabledPluginIds',
  'enabledOfficialToolIds',
  'providerId',
  'providerRoute',
  'providerExecutionIdentity',
  'providerEnvJson',
] as const satisfies ReadonlyArray<keyof SessionSnapshotPatchPayload>;

const BASELINE_KEYS = [
  'runtime',
  ...SNAPSHOT_KEYS,
] as const satisfies ReadonlyArray<keyof SessionMetadata>;

type SnapshotUpdate = Partial<Pick<SessionMetadata, (typeof BASELINE_KEYS)[number] | 'configSnapshotAt'>>;

function copyPresentSnapshotFields(source: Partial<SessionMetadata> | undefined): SnapshotUpdate {
  const copied: SnapshotUpdate = {};
  if (!source) return copied;
  for (const key of BASELINE_KEYS) {
    const value = source[key];
    if (value !== undefined) {
      (copied as Record<string, unknown>)[key] = Array.isArray(value) ? [...value] : value;
    }
  }
  return copied;
}

function hasOwnSnapshotPayloadKey<K extends keyof SessionSnapshotPatchPayload>(
  payload: SessionSnapshotPatchPayload,
  key: K,
): boolean {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

function normalizeProviderId(value: SessionMetadata['providerId'] | null | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function providerIdBeforePatch(args: {
  existing: SessionMetadata;
  baseSnapshot?: Partial<SessionMetadata>;
}): string | undefined {
  if (args.existing.providerId !== undefined) {
    return normalizeProviderId(args.existing.providerId);
  }
  return normalizeProviderId(args.baseSnapshot?.providerId);
}

/**
 * Build the metadata update for PATCH /sessions/:id config-snapshot fields.
 *
 * Important ownership rule: the first desktop config edit promotes a legacy
 * session into a self-owned session. That promotion must freeze a complete
 * baseline before applying the explicit patch; otherwise a model-only patch
 * creates `model + configSnapshotAt` and silently drops permission/provider.
 */
export function buildSessionSnapshotPatchUpdates(args: {
  existing: SessionMetadata;
  payload: SessionSnapshotPatchPayload;
  baseSnapshot?: Partial<SessionMetadata>;
  nowIso: string;
}): SnapshotUpdate {
  const explicit: SnapshotUpdate = {};
  let wroteSnapshotField = false;

  for (const key of SNAPSHOT_KEYS) {
    if (!hasOwnSnapshotPayloadKey(args.payload, key)) continue;
    const value = args.payload[key];
    (explicit as Record<string, unknown>)[key] = value === null ? undefined : value;
    wroteSnapshotField = true;
  }

  if (hasOwnSnapshotPayloadKey(args.payload, 'providerRoute')) {
    const route = args.payload.providerRoute;
    if (isConcreteProviderRoute(route)) {
      explicit.providerId = route.providerId;
      explicit.model = route.model;
      explicit.providerExecutionIdentity = undefined;
      explicit.providerEnvJson = undefined;
    } else if (route === null) {
      explicit.providerId = undefined;
      explicit.providerEnvJson = undefined;
    }
  }

  if (hasOwnSnapshotPayloadKey(args.payload, 'providerExecutionIdentity')) {
    const identity = args.payload.providerExecutionIdentity;
    if (identity) {
      explicit.providerId = identity.providerId;
      explicit.model = identity.model;
      explicit.providerRoute = undefined;
      explicit.providerEnvJson = undefined;
    }
  }

  if (
    hasOwnSnapshotPayloadKey(args.payload, 'providerId') &&
    !hasOwnSnapshotPayloadKey(args.payload, 'providerEnvJson') &&
    normalizeProviderId(args.payload.providerId) !== providerIdBeforePatch(args)
  ) {
    explicit.providerEnvJson = undefined;
    if (!hasOwnSnapshotPayloadKey(args.payload, 'providerRoute')) {
      explicit.providerRoute = undefined;
    }
    wroteSnapshotField = true;
  }

  if (!wroteSnapshotField) return {};

  if (args.existing.configSnapshotAt) {
    return {
      ...explicit,
      configSnapshotAt: args.nowIso,
    };
  }

  const baseline = {
    ...copyPresentSnapshotFields(args.baseSnapshot),
    ...copyPresentSnapshotFields(args.existing),
  };
  const runtime = (baseline.runtime ?? args.baseSnapshot?.runtime ?? args.existing.runtime ?? 'builtin') as RuntimeType;
  baseline.runtime ??= runtime;
  baseline.permissionMode ??= getDefaultRuntimePermissionMode(runtime);
  baseline.reasoningEffort ??= 'default';

  return {
    ...baseline,
    ...explicit,
    configSnapshotAt: args.nowIso,
  };
}
