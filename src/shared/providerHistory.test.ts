import { describe, expect, it } from 'vitest';

import {
  canResumeAcrossProviderBoundary,
  getProviderHistoryIdentity,
  getProviderHistoryIsolationCandidates,
  ISOLATED_PROVIDER_HISTORY_KEYS,
  normalizeProviderBaseUrl,
} from './providerHistory';

describe('provider resume boundary', () => {
  it('keeps managed history stable before binding and across proxy restarts', () => {
    const reference = { providerId: 'antigravity-sub', model: 'tested-model', apiProtocol: 'anthropic' as const,
      endpointSource: { kind: 'cliproxy' as const, providerId: 'antigravity-sub' as const } };
    const first = { ...reference, baseUrl: 'http://127.0.0.1:14001', apiKey: 'old-local-key' };
    const restarted = { ...reference, baseUrl: 'http://127.0.0.1:14002', apiKey: 'new-local-key' };
    expect(getProviderHistoryIdentity(reference)).toBe('third-party');
    expect(canResumeAcrossProviderBoundary(reference, first)).toBe(true);
    expect(canResumeAcrossProviderBoundary(first, restarted)).toBe(true);
    expect(canResumeAcrossProviderBoundary(reference, undefined)).toBe(false);
    expect(getProviderHistoryIsolationCandidates(reference)).toEqual(getProviderHistoryIsolationCandidates(restarted));
    const policy = { isolatedKeys: new Set(['provider:antigravity-sub']) };
    expect(getProviderHistoryIdentity(reference, policy)).toBe(getProviderHistoryIdentity(restarted, policy));
    expect(canResumeAcrossProviderBoundary(first, { ...restarted, model: 'another-model' }, policy)).toBe(false);
  });
  it('treats Anthropic subscription and official API as one signed-history family', () => {
    expect(getProviderHistoryIdentity(undefined)).toBe('anthropic');
    expect(getProviderHistoryIdentity({ baseUrl: 'https://api.anthropic.com/' })).toBe('anthropic');

    expect(canResumeAcrossProviderBoundary(undefined, { baseUrl: 'https://api.anthropic.com' })).toBe(true);
  });

  it('keeps the isolated set empty until a concrete provider/model is proven incompatible', () => {
    expect(ISOLATED_PROVIDER_HISTORY_KEYS.size).toBe(0);
  });

  it('allows resume across portable third-party providers that share a protocol family', () => {
    const first = { baseUrl: 'https://api.deepseek.com/anthropic/', apiProtocol: 'anthropic' as const };
    const second = { baseUrl: 'https://open.bigmodel.cn/api/anthropic', apiProtocol: 'anthropic' as const };

    expect(canResumeAcrossProviderBoundary(first, second)).toBe(true);
  });

  it('blocks resume between Anthropic signed history and portable third-party history', () => {
    expect(canResumeAcrossProviderBoundary(
      { baseUrl: 'https://api.deepseek.com/anthropic' },
      undefined,
    )).toBe(false);
    expect(canResumeAcrossProviderBoundary(
      undefined,
      { baseUrl: 'https://api.deepseek.com/anthropic' },
    )).toBe(false);
  });

  it('allows resume when a portable third-party provider changes transport protocol', () => {
    expect(canResumeAcrossProviderBoundary(
      { baseUrl: 'https://api.example.com/v1', apiProtocol: 'anthropic' },
      { baseUrl: 'https://api.example.com/v1', apiProtocol: 'openai' },
    )).toBe(true);
    expect(getProviderHistoryIdentity({ baseUrl: 'https://api.example.com/v1', apiProtocol: 'anthropic' })).toBe('third-party');
    expect(getProviderHistoryIdentity({ baseUrl: 'https://api.example.com/v1', apiProtocol: 'openai' })).toBe('third-party');
  });

  it('normalizes trailing slashes without guessing path semantics', () => {
    expect(normalizeProviderBaseUrl('https://api.example.com/v1///')).toBe('https://api.example.com/v1');
    expect(normalizeProviderBaseUrl('not a url///')).toBe('not a url');
  });

  it('exposes exact isolation key candidates for future provider/model quarantines', () => {
    expect(getProviderHistoryIsolationCandidates({
      providerId: 'xunfei',
      model: 'xopqwen36v35b',
      apiProtocol: 'anthropic',
      baseUrl: 'https://example.com/anthropic/',
    })).toEqual([
      'provider:xunfei',
      'model:xopqwen36v35b',
      'endpoint:anthropic:https://example.com/anthropic',
    ]);
  });

  it('blocks entering or leaving an isolated provider/model when a policy marks it incompatible', () => {
    const policy = { isolatedKeys: new Set(['model:xopqwen36v35b']) };
    const portable = {
      providerId: 'deepseek',
      model: 'deepseek-v4-flash',
      baseUrl: 'https://api.deepseek.com/anthropic',
      apiProtocol: 'anthropic' as const,
    };
    const isolated = {
      providerId: 'xunfei',
      model: 'xopqwen36v35b',
      baseUrl: 'https://spark-api-open.xf-yun.com/anthropic',
      apiProtocol: 'anthropic' as const,
    };

    expect(canResumeAcrossProviderBoundary(portable, isolated, policy)).toBe(false);
    expect(canResumeAcrossProviderBoundary(isolated, portable, policy)).toBe(false);
  });

  it('does not let two isolated entries share a transcript even when the same model id appears behind another provider', () => {
    const policy = { isolatedKeys: new Set(['model:xopqwen36v35b']) };

    expect(canResumeAcrossProviderBoundary(
      {
        providerId: 'xunfei',
        model: 'xopqwen36v35b',
        baseUrl: 'https://spark-api-open.xf-yun.com/anthropic',
        apiProtocol: 'anthropic',
      },
      {
        providerId: 'proxy',
        model: 'xopqwen36v35b',
        baseUrl: 'https://proxy.example.com/anthropic',
        apiProtocol: 'anthropic',
      },
      policy,
    )).toBe(false);
  });
});
