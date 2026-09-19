import { describe, expect, it, vi } from 'vitest';
import { readCodexModels, resolveManagedCodexEffort } from './codex-models';
import { CodexRuntime, buildCodexTurnStartParams } from './codex';
import type { RuntimeProcess } from './types';

const models = [{ value: 'sol', displayName: 'Sol', isDefault: true, defaultReasoningEffort: 'low', supportedReasoningEfforts: ['low', 'high', 'ultra', 'future-tier'].map(reasoningEffort => ({ reasoningEffort })) }, { value: 'luna', displayName: 'Luna', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] }];

describe('Codex model capabilities', () => {
  it('reads every page, preserving canonical model IDs and future effort descriptions', async () => {
    const call = vi.fn().mockResolvedValueOnce({ data: [{ id: 'alias', model: 'sol', displayName: 'Sol', defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'future-tier', description: 'Native description' }] }], nextCursor: 'page2' }).mockResolvedValueOnce({ data: [{ id: 'luna' }], nextCursor: null });
    const result = await readCodexModels({ call });
    expect(call).toHaveBeenNthCalledWith(2, 'model/list', { includeHidden: false, cursor: 'page2' }, 10_000);
    expect(result.map(model => model.value)).toEqual(['sol', 'luna']);
    expect(result[0]).toMatchObject({ defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'future-tier', description: 'Native description' }] });
    expect(result[1].supportedReasoningEfforts).toBeUndefined();
  });
  it('resolves explicit → default and unsupported model switches into concrete wire values', () => {
    const base = { threadId: 'thread', input: [], cwd: '/tmp', approvalPolicy: 'never' as const, sandbox: 'danger-full-access' as const };
    const efforts = [['sol', 'ultra'], ['sol', ''], ['luna', 'ultra'], ['sol', 'future-tier']].map(([model, effort]) => buildCodexTurnStartParams({ ...base, reasoningEffort: resolveManagedCodexEffort(models, model, effort) }).effort);
    expect(efforts).toEqual(['ultra', 'low', 'medium', 'future-tier']);
    expect(resolveManagedCodexEffort(models, '', '')).toBe('low');
  });
  it('sends model defaults after an in-place effort reset and model switch on the actual adapter', async () => {
    const call = vi.fn().mockResolvedValue({ turn: { id: 'turn' } });
    const state = { exited: false, runtimeSource: 'managed-provider', model: 'sol', models, reasoningEffort: 'ultra', rpc: { call }, workspacePath: '/tmp', threadId: 'thread', approvalPolicy: 'never', sandbox: 'danger-full-access', activeRootTurnAdmission: null };
    const process = state as unknown as RuntimeProcess;
    const runtime = new CodexRuntime();
    await runtime.sendMessage(process, 'first', undefined, { clientUserMessageId: '1' });
    expect(call.mock.calls[0][1].effort).toBe('ultra');
    state.activeRootTurnAdmission = null; // native turn completed
    // /api/runtime/config normalizes the persisted default sentinel to undefined.
    await runtime.setModel(process, 'luna');
    await runtime.setReasoningEffort(process, undefined);
    await runtime.sendMessage(process, 'second', undefined, { clientUserMessageId: '2' });
    expect(call.mock.calls[1][1].effort).toBe('medium');
    state.activeRootTurnAdmission = null;
    await runtime.setModel(process, 'sol');
    await runtime.setReasoningEffort(process, undefined);
    await runtime.sendMessage(process, 'third', undefined, { clientUserMessageId: '3' });
    expect(call.mock.calls[2][1]).toMatchObject({ model: 'sol', effort: 'low' });
  });

  it('preserves saved explicit intent on discovery failure and never fakes a default reset', () => {
    expect(resolveManagedCodexEffort([], 'sol', 'future-tier')).toBe('future-tier');
    expect(() => resolveManagedCodexEffort([], 'sol', '')).toThrow('default reasoning effort');
  });
  it('does not return cached capabilities when the queried process exits', async () => {
    const state = { exited: false, rpc: { call: vi.fn(async () => { state.exited = true; return { data: [{ id: 'old' }] }; }) }, models };
    await expect(new CodexRuntime().queryModels({ runtimeSource: 'managed-provider', process: state as unknown as RuntimeProcess })).rejects.toThrow('exited');
  });
  it('queries the live process instead of resolving a newly installed binary, keeping its catalog on failure', async () => {
    const call = vi.fn().mockResolvedValueOnce({ data: [{ id: 'old-model', supportedReasoningEfforts: [{ reasoningEffort: 'old-tier' }], defaultReasoningEffort: 'old-tier' }] }).mockRejectedValueOnce(new Error('disconnected'));
    const proc = { exited: false, rpc: { call }, models: [] } as unknown as RuntimeProcess;
    const runtime = new CodexRuntime();
    const first = await runtime.queryModels({ runtimeSource: 'managed-provider', process: proc });
    expect(first[0].value).toBe('old-model');
    expect(await runtime.queryModels({ runtimeSource: 'managed-provider', process: proc })).toEqual(first);
  });
});
