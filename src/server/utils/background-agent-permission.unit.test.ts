import { describe, it, expect } from 'vitest';
import {
  decideBackgroundAgentPermission,
  isBackgroundAgentToolRequest,
  backgroundAgentDenyMessage,
  DEFAULT_BACKGROUND_AGENT_PERMISSION_MODE,
  type BackgroundPermissionInput,
} from './background-agent-permission';

describe('isBackgroundAgentToolRequest (the security-critical discriminator)', () => {
  const running = new Map<string, unknown>([['task-abc', {}]]);
  it('false for the main thread (no agent_id)', () => {
    expect(isBackgroundAgentToolRequest(undefined, running)).toBe(false);
    expect(isBackgroundAgentToolRequest(null, running)).toBe(false);
    expect(isBackgroundAgentToolRequest('', running)).toBe(false);
  });
  it('false for a foreground sub-agent (agent_id set but NOT a running background task)', () => {
    expect(isBackgroundAgentToolRequest('some-fg-subagent', running)).toBe(false);
  });
  it('true only when agent_id matches a running background task (task_id === agent_id)', () => {
    expect(isBackgroundAgentToolRequest('task-abc', running)).toBe(true);
  });
  it('works with a Set too (structural has())', () => {
    expect(isBackgroundAgentToolRequest('x', new Set(['x']))).toBe(true);
    expect(isBackgroundAgentToolRequest('y', new Set(['x']))).toBe(false);
  });
});

const base: BackgroundPermissionInput = {
  isBackgroundAgent: true,
  toolName: 'Bash',
  sessionAllowsTool: false,
  policy: 'inherit',
};

describe('decideBackgroundAgentPermission', () => {
  it('passes through when NOT a background agent (foreground keeps canUseTool authority)', () => {
    // Every other field would otherwise force a decision — isBackgroundAgent gates it.
    expect(decideBackgroundAgentPermission({ ...base, isBackgroundAgent: false })).toBe('passthrough');
    expect(decideBackgroundAgentPermission({ ...base, isBackgroundAgent: false, sessionAllowsTool: true })).toBe('passthrough');
    expect(decideBackgroundAgentPermission({ ...base, isBackgroundAgent: false, policy: 'fullAgency' })).toBe('passthrough');
  });

  it('inherits session "always allow" grants in default mode (the #264 ask)', () => {
    expect(decideBackgroundAgentPermission({ ...base, sessionAllowsTool: true })).toBe('allow');
  });

  it('denies an ungranted tool in default (inherit) mode', () => {
    expect(decideBackgroundAgentPermission({ ...base, sessionAllowsTool: false, policy: 'inherit' })).toBe('deny');
  });

  it('allows any non-interaction tool under opt-in fullAgency', () => {
    expect(decideBackgroundAgentPermission({ ...base, toolName: 'WebFetch', policy: 'fullAgency' })).toBe('allow');
    expect(decideBackgroundAgentPermission({ ...base, toolName: 'Bash', policy: 'fullAgency' })).toBe('allow');
  });

  it('never auto-resolves user-interaction tools, even under fullAgency', () => {
    for (const tool of ['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode']) {
      expect(decideBackgroundAgentPermission({ ...base, toolName: tool, policy: 'fullAgency' })).toBe('deny');
      // …even if somehow "always allowed": a human is still required.
      expect(decideBackgroundAgentPermission({ ...base, toolName: tool, sessionAllowsTool: true, policy: 'fullAgency' })).toBe('deny');
    }
  });

  it('grant inheritance takes precedence over the policy branch', () => {
    // granted + inherit => allow (not deny)
    expect(decideBackgroundAgentPermission({ ...base, sessionAllowsTool: true, policy: 'inherit' })).toBe('allow');
  });

  it('default mode constant is the conservative one', () => {
    expect(DEFAULT_BACKGROUND_AGENT_PERMISSION_MODE).toBe('inherit');
  });

  it('deny message names the tool and lists the recovery options', () => {
    const msg = backgroundAgentDenyMessage('Bash');
    expect(msg).toContain('Bash');
    expect(msg).toContain('始终允许');
    expect(msg).toContain('fullAgency');
  });
});
