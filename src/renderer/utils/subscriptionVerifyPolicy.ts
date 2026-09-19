import type { ProviderVerifyStatus } from '@/config/types';
import { isVerifyExpired } from '@/config/types';
import type { SubscriptionStatus } from '@/types/subscription';

function isSameKnownAccount(cachedEmail: string | undefined, currentEmail: string | undefined): boolean {
  if (cachedEmail || currentEmail) return cachedEmail === currentEmail;
  return true;
}

export function shouldUseCachedValidSubscriptionVerify(
  status: SubscriptionStatus,
  cached: ProviderVerifyStatus | undefined,
): boolean {
  if (!status.available || cached?.status !== 'valid') return false;
  return !isVerifyExpired(cached.verifiedAt)
    && isSameKnownAccount(cached.accountEmail, status.info?.email);
}
