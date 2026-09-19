export type {
  SubscriptionInfo,
  SubscriptionStatus,
  SubscriptionVerifyFailureKind,
  SubscriptionVerifyResult,
} from '../../shared/subscription';

import type { SubscriptionStatus } from '../../shared/subscription';

// Extended status for frontend with verification state
export interface SubscriptionStatusWithVerify extends SubscriptionStatus {
  verifyStatus?: 'idle' | 'loading' | 'valid' | 'invalid';
  verifyError?: string;
}
