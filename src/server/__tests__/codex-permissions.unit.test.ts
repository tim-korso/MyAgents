import { describe, expect, it } from 'vitest';
import { CODEX_PERMISSION_MODES, coercePermissionModeForRuntime, projectPermissionModeForRuntime } from '../../shared/types/runtime';
import { buildCodexTurnStartParams, codexProxyProbeIssue, CodexRuntime, codexWorkspacePolicyFromConfig } from '../runtimes/codex';
import type { RuntimeProcess } from '../runtimes/types';

describe('Codex native permission presets', () => {
  it('offers exactly the native three choices while preserving historical read-only sessions', () => {
    expect(CODEX_PERMISSION_MODES.map(mode => mode.label)).toEqual([
      'Ask for approval', 'Approve for me', 'Full Access',
    ]);
    expect(projectPermissionModeForRuntime('suggest', 'codex')).toBe('suggest');
  });

  it('keeps hidden legacy suggest confined to Codex when changing runtimes', () => {
    expect(coercePermissionModeForRuntime('suggest', 'codex')).toBe('suggest');
    for (const runtime of ['builtin', 'gemini', 'claude-code'] as const) {
      expect(coercePermissionModeForRuntime('suggest', runtime)).toBeUndefined();
    }
  });

  it.each([
    ['system-cli', 'auto-edit', 'on-request', 'workspace-write', 'user'],
    ['managed-provider', 'auto-edit', 'on-request', 'workspace-write', 'auto_review'],
    ['system-cli', 'full-auto', 'on-request', 'workspace-write', 'auto_review'],
    ['managed-provider', 'suggest', 'untrusted', 'read-only', 'user'],
    ['system-cli', 'suggest', 'untrusted', 'read-only', 'user'],
    ['managed-provider', 'no-restrictions', 'never', 'danger-full-access', 'user'],
    ['system-cli', 'no-restrictions', 'never', 'danger-full-access', 'user'],
  ])('%s / %s carries the native approval combination', async (runtimeSource, mode, approvalPolicy, sandbox, approvalsReviewer) => {
    const process = { runtimeSource, exited: false, supportsApprovalsReviewer: true };
    await new CodexRuntime().setPermissionMode(process as unknown as RuntimeProcess, mode);
    expect(process).toMatchObject({ permissionMode: mode, approvalPolicy, sandbox, approvalsReviewer });
  });

  it('resets the automatic reviewer when returning to human approval', async () => {
    const process = { runtimeSource: 'system-cli', exited: false, supportsApprovalsReviewer: true };
    const runtime = new CodexRuntime();
    await runtime.setPermissionMode(process as unknown as RuntimeProcess, 'full-auto');
    await runtime.setPermissionMode(process as unknown as RuntimeProcess, 'auto-edit');
    expect(process).toMatchObject({ approvalPolicy: 'on-request', approvalsReviewer: 'user' });
  });

  it('sends a reviewer even for manual turns so native state cannot retain auto-review', () => {
    const params = buildCodexTurnStartParams({
      threadId: 't', input: [], cwd: '/workspace',
      approvalPolicy: 'on-request', sandbox: 'workspace-write',
    });
    expect(params.approvalsReviewer).toBe('user');
  });

  it('retains native network, additional roots and temp exclusions after leaving Full Access', () => {
    const workspacePolicy = codexWorkspacePolicyFromConfig({ config: { sandbox_workspace_write: {
      network_access: true, writable_roots: ['/extra'], exclude_tmpdir_env_var: true, exclude_slash_tmp: true,
    } } });
    const base = { threadId: 't', input: [], cwd: '/workspace', approvalPolicy: 'on-request' as const, workspacePolicy };
    expect(buildCodexTurnStartParams({ ...base, sandbox: 'danger-full-access' }).sandboxPolicy).toEqual({ type: 'dangerFullAccess' });
    expect(buildCodexTurnStartParams({ ...base, sandbox: 'workspace-write', approvalsReviewer: 'auto_review' })).toMatchObject({
      approvalsReviewer: 'auto_review',
      sandboxPolicy: { type: 'workspaceWrite', writableRoots: ['/extra'], networkAccess: true, excludeTmpdirEnvVar: true, excludeSlashTmp: true },
    });
    expect(buildCodexTurnStartParams({ ...base, sandbox: 'read-only' }).sandboxPolicy).toEqual({ type: 'readOnly', networkAccess: false });
  });

  it('refuses an automatic reviewer unsupported by the native process without mutating the current mode', async () => {
    const process = { runtimeSource: 'system-cli', exited: false, supportsApprovalsReviewer: false, permissionMode: 'auto-edit' };
    await expect(new CodexRuntime().setPermissionMode(process as unknown as RuntimeProcess, 'full-auto')).rejects.toThrow('does not support');
    expect(process.permissionMode).toBe('auto-edit');
  });

  it('does not turn expected pre-approval network restriction into a session failure', () => {
    const probe = { detected: true, networkDisabled: true, proxyProbe: { url: 'http://127.0.0.1:1234', reachable: false, error: 'EPERM' } };
    const policy = codexWorkspacePolicyFromConfig({});
    expect(codexProxyProbeIssue(probe, policy)).toMatchObject({ severity: 'info', code: 'codex_proxy_requires_network_approval' });
    expect(codexProxyProbeIssue(probe, { ...policy, networkAccess: true })).toMatchObject({ severity: 'error' });
    expect(codexProxyProbeIssue({ ...probe, proxyProbe: { ...probe.proxyProbe, reachable: true } }, policy)).toBeUndefined();
  });
});
