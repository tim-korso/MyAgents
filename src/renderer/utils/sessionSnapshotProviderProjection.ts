import { CODEX_SUBSCRIPTION_PROVIDER_ID } from '@/config/types';
import type { RuntimeBackedProviderIdentity } from '../../shared/providerExecution';
import type { RuntimeSource, RuntimeType } from '../../shared/types/runtime';

export type ProviderProjectedSessionSnapshot = {
  runtimeSource?: RuntimeSource;
  providerId?: string | null;
  providerExecutionIdentity?: RuntimeBackedProviderIdentity | null;
};

export function isManagedProviderSessionSnapshot(
  session: ProviderProjectedSessionSnapshot | null | undefined,
): boolean {
  return session?.runtimeSource === 'managed-provider'
    || session?.providerExecutionIdentity?.kind === 'runtime-backed-provider';
}

export function shouldSessionSnapshotUseProviderPicker(args: {
  session: ProviderProjectedSessionSnapshot | null | undefined;
  runtime: RuntimeType;
}): boolean {
  return args.runtime === 'builtin' || isManagedProviderSessionSnapshot(args.session);
}

export function managedProviderSnapshotProviderId(
  session: ProviderProjectedSessionSnapshot,
): typeof CODEX_SUBSCRIPTION_PROVIDER_ID | undefined {
  if (!isManagedProviderSessionSnapshot(session)) return undefined;
  return session.providerExecutionIdentity?.providerId
    ?? (session.providerId === CODEX_SUBSCRIPTION_PROVIDER_ID
      ? CODEX_SUBSCRIPTION_PROVIDER_ID
      : undefined)
    ?? CODEX_SUBSCRIPTION_PROVIDER_ID;
}

export function managedProviderSnapshotModel(
  session: ProviderProjectedSessionSnapshot,
  fallbackModel: string | undefined,
): string | undefined {
  if (!isManagedProviderSessionSnapshot(session)) return fallbackModel;
  return session.providerExecutionIdentity?.model ?? fallbackModel;
}
