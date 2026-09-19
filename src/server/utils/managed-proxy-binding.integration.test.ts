import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { ProviderEnv } from '../provider-types';

const api = vi.hoisted(() => vi.fn());
vi.mock('./management-api-client', () => ({ managementApi: api }));
import { assertManagedProviderPrepared, controlManagedProxyBinding, prepareProviderBinding, validateManagedProxyBinding } from './managed-proxy-binding';

const provider: ProviderEnv = { providerId: 'antigravity-sub', apiProtocol: 'anthropic',
  endpointSource: { kind: 'cliproxy', providerId: 'antigravity-sub' } };
const binding = () => ({ providerId: 'antigravity-sub', baseUrl: 'http://127.0.0.1:13491', apiKey: 'a'.repeat(96),
  instanceGeneration: randomUUID(), accountGeneration: randomUUID(), leaseId: randomUUID(), modelPolicy: { id: 'approved', thinking: false } });
afterEach(() => { vi.unstubAllEnvs(); api.mockReset(); });

describe('managed proxy Query resource', () => {
  it('does not contact or wait for CLIProxy for other providers', async () => {
    api.mockRejectedValue(new Error('CLIProxy initialization failed'));
    const ordinary: ProviderEnv = { providerId: 'other', apiProtocol: 'anthropic', baseUrl: 'https://example.invalid', apiKey: 'test' };
    const resource = await prepareProviderBinding({ providerEnv: ordinary, model: 'model', controller: new AbortController() });
    expect(resource.providerEnv).toBe(ordinary);
    await resource.beforeTurn();
    await resource.reportTerminal(true);
    await resource.release();
    expect(api).not.toHaveBeenCalled();
  });

  it('reports each real terminal for its exact lease and does not record cancellation or released results', async () => {
    vi.stubEnv('MYAGENTS_SIDECAR_ID', 'session-test');
    const grant = binding();
    api.mockImplementation(async path => path.endsWith('/acquire') ? { ok: true, binding: grant } : { ok: true });
    const controller = new AbortController();
    const resource = await prepareProviderBinding({ providerEnv: provider, model: 'approved', controller });
    await resource.beforeTurn(); await resource.reportTerminal(true); await resource.reportTerminal(false);
    await resource.beforeTurn(); await resource.reportTerminal(false);
    await resource.beforeTurn(); controller.abort(); await resource.reportTerminal(false);
    await resource.release(); await resource.reportTerminal(true);
    const outcomes = api.mock.calls.filter(([, , body]) => body?.terminal).map(([, , body]) => body);
    expect(outcomes.map(body => body.terminal)).toEqual(['succeeded', 'failed']);
    expect(outcomes.every(body => body.leaseId === grant.leaseId && body.operationId === api.mock.calls[0][2].operationId)).toBe(true);
  });
  it('preserves explicit provider aliases instead of forcing every subagent onto the main model', async () => {
    vi.stubEnv('MYAGENTS_SIDECAR_ID', 'session-test');
    api.mockImplementation(async path => path.endsWith('/acquire') ? { ok: true, binding: binding() } : { ok: true });
    const resource = await prepareProviderBinding({ providerEnv: { ...provider, modelAliases: { sonnet: 'gemini-3.8-flash-high', opus: 'another-native-model' } }, model: 'approved', controller: new AbortController() });
    expect(resource.providerEnv?.modelAliases?.sonnet).toBe('gemini-3.8-flash-high');
    expect(resource.providerEnv?.modelAliases?.opus).toBe('another-native-model');
    await resource.release();
  });
  it('refuses unresolved or persisted bindings; keeps the original provider reference non-secret', async () => {
    vi.stubEnv('MYAGENTS_SIDECAR_ID', 'session-test');
    const grant = binding();
    api.mockImplementation(async path => path.endsWith('/acquire') ? { ok: true, binding: grant } : { ok: true });
    expect(() => assertManagedProviderPrepared(provider)).toThrow('必须先准备');
    const resource = await prepareProviderBinding({ providerEnv: provider, model: 'approved', controller: new AbortController() });
    expect(() => assertManagedProviderPrepared(resource.providerEnv)).not.toThrow();
    expect(() => assertManagedProviderPrepared({ ...resource.providerEnv })).toThrow();
    expect(provider.baseUrl).toBeUndefined();
    expect(provider.apiKey).toBeUndefined();
    expect(resource.providerEnv?.modelAliases).toEqual({ fable: 'approved', sonnet: 'approved', opus: 'approved', haiku: 'approved' });
    await resource.beforeTurn();
    await resource.release();
    await resource.release();
    expect(api.mock.calls.filter(([path]) => path.endsWith('/release'))).toHaveLength(1);
    expect(() => assertManagedProviderPrepared(resource.providerEnv)).toThrow();
  });
  it('releases by operation ID when acquire has an unknown outcome', async () => {
    vi.stubEnv('MYAGENTS_SIDECAR_ID', 'session-test');
    api.mockResolvedValueOnce({ ok: false, code: 'transport_outcome_unknown' }).mockResolvedValue({ ok: true });
    await expect(prepareProviderBinding({ providerEnv: provider, model: 'approved', controller: new AbortController() })).rejects.toThrow();
    const acquire = api.mock.calls[0][2];
    expect(api.mock.calls[1][2]).toEqual({ sidecarId: 'session-test', operationId: acquire.operationId });
    expect(api.mock.calls[1][3]).toBeUndefined();
  });
  it('settles a control that arrives before the acquire response', async () => {
    vi.stubEnv('MYAGENTS_SIDECAR_ID', 'session-test');
    const grant = binding();
    let respond!: (value: unknown) => void;
    api.mockImplementation(path => path.endsWith('/acquire') ? new Promise(resolve => { respond = resolve; }) : Promise.resolve({ ok: true }));
    const preparation = prepareProviderBinding({ providerEnv: provider, model: 'approved', controller: new AbortController(), onDrain: vi.fn() });
    const stop = vi.fn();
    expect(await controlManagedProxyBinding({ action: 'drain', operationId: api.mock.calls[0][2].operationId,
      leaseId: grant.leaseId, instanceGeneration: grant.instanceGeneration }, stop)).toEqual({ accepted: true, settled: false });
    respond({ ok: true, binding: grant });
    await expect(preparation).rejects.toMatchObject({ code: 'draining' });
    expect(stop).not.toHaveBeenCalled();
    expect(api.mock.calls.at(-1)?.[0]).toBe('/api/cliproxy/binding/release');
  });
  it('drains the exact persistent Query and aborts auxiliary work independently', async () => {
    vi.stubEnv('MYAGENTS_SIDECAR_ID', 'session-test');
    const grants = [binding(), binding()];
    let next = 0;
    api.mockImplementation(async path => path.endsWith('/acquire') ? { ok: true, binding: grants[next++] } : { ok: true });
    const drain = vi.fn(); const stop = vi.fn();
    const controller = new AbortController();
    const persistent = await prepareProviderBinding({ providerEnv: provider, model: 'approved', controller: new AbortController(), onDrain: drain });
    const auxiliary = await prepareProviderBinding({ providerEnv: provider, model: 'approved', controller });
    const acquisitions = api.mock.calls.filter(([path]) => path.endsWith('/acquire'));
    const control = (i: number, action: string) => ({ action, operationId: acquisitions[i][2].operationId,
      leaseId: grants[i].leaseId, instanceGeneration: grants[i].instanceGeneration });
    expect(await controlManagedProxyBinding({ ...control(0, 'stop'), instanceGeneration: randomUUID() }, stop)).toEqual({ accepted: false, settled: false });
    await controlManagedProxyBinding(control(0, 'drain'), stop);
    expect(drain).toHaveBeenCalledOnce();
    await expect(persistent.beforeTurn()).rejects.toMatchObject({ code: 'draining' });
    await controlManagedProxyBinding(control(1, 'stop'), stop);
    expect(controller.signal.aborted).toBe(true);
    expect(stop).not.toHaveBeenCalled();
    await persistent.release(); await auxiliary.release();
  });
  it('confirms a closed SDK owner through drain when its release could not reach Rust', async () => {
    vi.stubEnv('MYAGENTS_SIDECAR_ID', 'session-test');
    const grant = binding();
    api.mockResolvedValueOnce({ ok: true, binding: grant }).mockResolvedValue({ ok: false, code: 'transport_outcome_unknown' });
    const resource = await prepareProviderBinding({ providerEnv: provider, model: 'approved', controller: new AbortController() });
    const operationId = api.mock.calls[0][2].operationId;
    await expect(resource.release()).rejects.toMatchObject({ code: 'transport_outcome_unknown' });
    expect(await controlManagedProxyBinding({ action: 'drain', operationId, leaseId: grant.leaseId,
      instanceGeneration: grant.instanceGeneration }, vi.fn())).toEqual({ accepted: true, settled: true });
  });
  it('repeated drain does not repeatedly restart a live persistent Query', async () => {
    vi.stubEnv('MYAGENTS_SIDECAR_ID', 'session-test');
    const grant = binding(); const drain = vi.fn();
    api.mockImplementation(async path => path.endsWith('/acquire') ? { ok: true, binding: grant } : { ok: true });
    const resource = await prepareProviderBinding({ providerEnv: provider, model: 'approved', controller: new AbortController(), onDrain: drain });
    const control = { action: 'drain', operationId: api.mock.calls[0][2].operationId,
      leaseId: grant.leaseId, instanceGeneration: grant.instanceGeneration };
    expect(await controlManagedProxyBinding(control, vi.fn())).toEqual({ accepted: true, settled: false });
    expect(await controlManagedProxyBinding(control, vi.fn())).toEqual({ accepted: true, settled: false });
    expect(drain).toHaveBeenCalledOnce();
    await resource.release();
  });
  it.each(['http://localhost:1234', 'https://127.0.0.1:1234', 'http://127.0.0.1:1234/v1',
    'http://127.0.0.1:1234@remote.test', 'http://127.0.0.1:99999'])('rejects an unexpected model destination %s', baseUrl => {
    expect(() => validateManagedProxyBinding({ ...binding(), baseUrl })).toThrow();
  });
});
