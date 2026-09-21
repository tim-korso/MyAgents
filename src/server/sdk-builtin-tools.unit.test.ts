import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  SDK_BUILTIN_TOOLS,
  SDK_EXCLUDED_BUILTIN_TOOLS,
  resolveBuiltinToolSurface,
} from './sdk-builtin-tools';

describe('Claude Agent SDK builtin catalog', () => {
  it('keeps the product-owned 29-tool catalog exact and duplicate-free', () => {
    expect(SDK_BUILTIN_TOOLS).toEqual([
      'Read',
      'Write',
      'Edit',
      'MultiEdit',
      'NotebookEdit',
      'Glob',
      'Grep',
      'Bash',
      'PowerShell',
      'WebFetch',
      'WebSearch',
      'AskUserQuestion',
      'EnterPlanMode',
      'ExitPlanMode',
      'Skill',
      'Agent',
      'Task',
      'TaskStop',
      'SendMessage',
      'TaskCreate',
      'TaskGet',
      'TaskList',
      'TaskUpdate',
      'Monitor',
      'ReportFindings',
      'Workflow',
      'ScheduleWakeup',
      'EnterWorktree',
      'ExitWorktree',
    ]);
    expect(new Set(SDK_BUILTIN_TOOLS).size).toBe(29);
    expect(SDK_BUILTIN_TOOLS).not.toContain('TaskOutput');
  });

  it('does not expose any product-excluded builtin', () => {
    expect(SDK_EXCLUDED_BUILTIN_TOOLS).toHaveLength(5);
    for (const tool of SDK_EXCLUDED_BUILTIN_TOOLS) {
      expect(SDK_BUILTIN_TOOLS).not.toContain(tool);
    }
  });

  it('keeps control-plane SDK queries tool-free while product sessions use the catalog', () => {
    for (const relativePath of [
      'provider-verify.ts',
      'subscription-auth.ts',
      'title-generator.ts',
      'official-tools/vision.ts',
    ]) {
      const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
      const queryCount = source.match(/\bquery\(\{/g)?.length ?? 0;
      const disabledToolCount = source.match(/\btools:\s*\[\]/g)?.length ?? 0;
      expect(queryCount, `${relativePath} should contain a production SDK query`).toBeGreaterThan(0);
      expect(disabledToolCount, `${relativePath} must disable tools on every control query`).toBeGreaterThanOrEqual(queryCount);
    }

    const sessionSource = readFileSync(new URL('agent-session.ts', import.meta.url), 'utf8');
    // Product sessions grant the resolved surface (the full catalog unless a
    // user narrowed it — see resolveBuiltinToolSurface). The invariant under
    // test is unchanged: control queries get `tools: []`, product sessions get
    // a real surface.
    expect(sessionSource).toContain('tools: resolveBuiltinToolSurface(');
  });
});

// The surface is part of the prompt prefix, so narrowing it changes model
// behaviour — that is the point — but a bad allowlist must never yield a
// session that cannot work.
describe('resolveBuiltinToolSurface', () => {
  it('returns the full catalog when nothing is configured', () => {
    expect(resolveBuiltinToolSurface()).toEqual([...SDK_BUILTIN_TOOLS]);
    expect(resolveBuiltinToolSurface([])).toEqual([...SDK_BUILTIN_TOOLS]);
    expect(resolveBuiltinToolSurface(null)).toEqual([...SDK_BUILTIN_TOOLS]);
  });

  it('narrows to the allowlist', () => {
    const surface = resolveBuiltinToolSurface(['Read', 'Grep']);
    expect(surface).toContain('Read');
    expect(surface).toContain('Grep');
    expect(surface).not.toContain('WebSearch');
  });

  it('always keeps the tools a session needs to function', () => {
    // An allowlist naming only an exotic tool must not produce a session that
    // opens and then cannot read, run, or reply.
    const surface = resolveBuiltinToolSurface(['Monitor']);
    for (const required of ['Read', 'Bash', 'Edit', 'Write']) {
      expect(surface).toContain(required);
    }
  });

  it('ignores names outside the product catalog', () => {
    // Config must not be able to inject a tool the product does not own.
    const surface = resolveBuiltinToolSurface(['Read', 'NotARealTool', 'CronCreate']);
    expect(surface).not.toContain('NotARealTool');
    expect(surface).not.toContain('CronCreate');
  });

  it('preserves canonical catalog order regardless of the allowlist order', () => {
    // Tool order is part of the cached prompt prefix; reordering it would
    // silently invalidate the provider-side cache.
    const a = resolveBuiltinToolSurface(['Write', 'Read', 'Bash']);
    const b = resolveBuiltinToolSurface(['Bash', 'Read', 'Write']);
    expect(a).toEqual(b);
    const indexes = a.map((name) => (SDK_BUILTIN_TOOLS as readonly string[]).indexOf(name));
    expect([...indexes].sort((x, y) => x - y)).toEqual(indexes);
  });
});
