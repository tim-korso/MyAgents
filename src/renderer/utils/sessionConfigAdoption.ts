import { SUBSCRIPTION_PROVIDER_ID } from '../../shared/config-types';

export function resolveAdoptedBuiltinProviderId(
  sidecarIsExternal: boolean,
  providerId: string | null | undefined,
): string | undefined {
  if (sidecarIsExternal || providerId === undefined) return undefined;
  return providerId ?? SUBSCRIPTION_PROVIDER_ID;
}
