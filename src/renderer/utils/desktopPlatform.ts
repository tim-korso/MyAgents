import { getPlatform } from '@/identity/deviceIdentity';
import { ANTIGRAVITY_SUBSCRIPTION_PROVIDER_ID, CODEX_SUBSCRIPTION_PROVIDER_ID } from '@/config/types';

const LINUX_HIDDEN_PROVIDER_IDS = [CODEX_SUBSCRIPTION_PROVIDER_ID, ANTIGRAVITY_SUBSCRIPTION_PROVIDER_ID];

/** Use the existing Rust-backed device identity; no persisted feature switch. */
export function isLinuxDesktop(): boolean {
  return getPlatform().startsWith('linux-');
}

export function getPlatformHiddenProviderIds(): readonly string[] {
  return isLinuxDesktop() ? LINUX_HIDDEN_PROVIDER_IDS : [];
}
