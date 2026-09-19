import { describe, expect, it } from 'vitest';

import { canonicalizeManagedProviderEnv, materializeProviderRouteEnv, resolveProviderEnv } from './admin-config';

describe('xai-sub managed ProviderEnv materialization', () => {
  it('preserves persisted split model aliases when materializing a CLIProxy route', () => {
    const env = materializeProviderRouteEnv({
      kind: 'subscription', providerId: 'antigravity-sub', model: 'main-model',
    }, { providerModelAliases: { 'antigravity-sub': { sonnet: 'child-model', opus: 'main-model' } } });
    expect(env?.modelAliases).toMatchObject({ sonnet: 'child-model', opus: 'main-model' });
    expect(canonicalizeManagedProviderEnv(env!)?.modelAliases).toEqual(env?.modelAliases);
  });

  it('materializes Antigravity routes as a non-secret builtin endpoint reference', () => {
    const env = materializeProviderRouteEnv({ kind: 'subscription', providerId: 'antigravity-sub', model: 'tested-model' }, {});
    expect(env).toMatchObject({ providerId: 'antigravity-sub', apiProtocol: 'anthropic',
      endpointSource: { kind: 'cliproxy', providerId: 'antigravity-sub' } });
    expect(env).not.toHaveProperty('baseUrl');
    expect(env).not.toHaveProperty('apiKey');
    expect(env).not.toHaveProperty('credentialSource');
    const restored = canonicalizeManagedProviderEnv({ ...env, baseUrl: 'http://127.0.0.1:19999', apiKey: 'persisted-key' });
    expect(restored).not.toHaveProperty('baseUrl');
    expect(restored).not.toHaveProperty('apiKey');
    expect(restored?.endpointSource).toEqual(env?.endpointSource);
  });
  it('materializes a non-secret Responses provider reference without an API key', () => {
    const env = resolveProviderEnv('xai-sub', {});

    expect(env).toMatchObject({
      providerId: 'xai-sub',
      baseUrl: 'https://api.x.ai/v1',
      apiProtocol: 'openai',
      upstreamFormat: 'responses',
      credentialSource: { kind: 'managed-oauth', providerId: 'xai-sub' },
    });
    expect(env).not.toHaveProperty('apiKey');
    expect(JSON.stringify(env)).not.toContain('accessToken');
    expect(JSON.stringify(env)).not.toContain('refreshToken');
  });

  it('keeps Anthropic subscription on the native sentinel path', () => {
    expect(resolveProviderEnv('anthropic-sub', {})).toBeUndefined();
    expect(materializeProviderRouteEnv({
      kind: 'subscription',
      providerId: 'anthropic-sub',
      model: 'claude-sonnet-5',
    }, {})).toBeUndefined();
  });

  it('materializes a concrete Grok subscription route', () => {
    expect(materializeProviderRouteEnv({
      kind: 'subscription',
      providerId: 'xai-sub',
      model: 'grok-4.5',
    }, {})).toMatchObject({
      providerId: 'xai-sub',
      credentialSource: { kind: 'managed-oauth' },
    });
  });

  it('pins a managed bearer to the canonical xAI Responses endpoint', () => {
    const canonical = canonicalizeManagedProviderEnv({
      providerId: 'xai-sub',
      baseUrl: 'https://attacker.example/collect',
      apiKey: 'attacker-controlled',
      apiProtocol: 'anthropic',
      upstreamFormat: 'chat_completions',
      credentialSource: { kind: 'managed-oauth', providerId: 'xai-sub' },
    });
    expect(canonical).toEqual(expect.objectContaining({
      providerId: 'xai-sub',
      baseUrl: 'https://api.x.ai/v1',
      apiProtocol: 'openai',
      upstreamFormat: 'responses',
      credentialSource: { kind: 'managed-oauth', providerId: 'xai-sub' },
    }));
    expect(canonical).not.toHaveProperty('apiKey');
  });
});
