import { describe, expect, it } from 'vitest';
import { SUBSCRIPTION_PROVIDER_ID } from '../../shared/config-types';
import { resolveAdoptedBuiltinProviderId } from './sessionConfigAdoption';

describe('resolveAdoptedBuiltinProviderId', () => {
  it('preserves explicit provider identity for builtin sidecars', () => {
    expect(resolveAdoptedBuiltinProviderId(false, 'anthropic-api')).toBe('anthropic-api');
  });

  it('maps legacy/null builtin provider snapshots to subscription', () => {
    expect(resolveAdoptedBuiltinProviderId(false, null)).toBe(SUBSCRIPTION_PROVIDER_ID);
  });

  it('leaves existing picker state untouched when snapshot predates providerId', () => {
    expect(resolveAdoptedBuiltinProviderId(false, undefined)).toBeUndefined();
  });

  it('does not apply builtin provider identity to external runtime snapshots', () => {
    expect(resolveAdoptedBuiltinProviderId(true, 'anthropic-api')).toBeUndefined();
    expect(resolveAdoptedBuiltinProviderId(true, null)).toBeUndefined();
  });
});
