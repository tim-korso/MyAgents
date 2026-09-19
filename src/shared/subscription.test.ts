import { describe, expect, it } from 'vitest';

import {
  classifySubscriptionVerifyFailureKind,
  formatSubscriptionVerifyError,
  isUserActionRequiredSubscriptionFailure,
} from './subscription';

describe('subscription verify failure classification', () => {
  it('classifies expired or missing OAuth credentials as auth-required', () => {
    expect(classifySubscriptionVerifyFailureKind('API Error: 401 Invalid authentication credentials')).toBe('auth_required');
    expect(classifySubscriptionVerifyFailureKind('Failed to authenticate. Please /login')).toBe('auth_required');
  });

  it('classifies subscription or permission failures as user-action required entitlement failures', () => {
    expect(classifySubscriptionVerifyFailureKind('API Error: 403 forbidden')).toBe('entitlement_required');
    expect(classifySubscriptionVerifyFailureKind('Subscription required to use this model')).toBe('entitlement_required');
  });

  it('keeps transient failures out of the terminal user-action bucket', () => {
    expect(isUserActionRequiredSubscriptionFailure(classifySubscriptionVerifyFailureKind('429 rate limit'))).toBe(false);
    expect(isUserActionRequiredSubscriptionFailure(classifySubscriptionVerifyFailureKind('network timeout'))).toBe(false);
    expect(isUserActionRequiredSubscriptionFailure('auth_required')).toBe(true);
  });

  it('formats the real verification detail when it is available', () => {
    expect(formatSubscriptionVerifyError({
      error: '登录已过期，请重新登录',
      detail: 'Not logged in · Please run /login',
    }, '验证失败')).toBe('登录已过期，请重新登录: Not logged in · Please run /login');
  });

  it('does not duplicate identical verification error text', () => {
    expect(formatSubscriptionVerifyError({
      error: 'Not logged in',
      detail: 'Not logged in',
    })).toBe('Not logged in');
  });
});
