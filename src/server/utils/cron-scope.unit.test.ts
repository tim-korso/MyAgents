import { describe, it, expect } from 'vitest';
import { buildCronScope } from './cron-scope';

describe('buildCronScope', () => {
  it('echoes a default (silent) scope and nudges toward --workspace', () => {
    const { scope, hint } = buildCronScope('C:/Users/me/projects/mino', false);
    expect(scope).toEqual({
      workspacePath: 'C:/Users/me/projects/mino',
      source: 'default',
      visibility: 'single-workspace',
    });
    // The whole point of #320's secondary fix: the note must make clear the
    // result is workspace-scoped AND name the (only) broadening command.
    expect(hint).toContain('C:/Users/me/projects/mino');
    expect(hint).toContain('其他工作区');
    expect(hint).toContain('myagents cron list --workspace');
  });

  it('drops the broaden nudge for an explicit --workspace caller (they already know)', () => {
    const { scope, hint } = buildCronScope('C:/Users/me/projects/mino', true);
    expect(scope.source).toBe('explicit');
    expect(hint).toContain('C:/Users/me/projects/mino');
    expect(hint).not.toContain('--workspace');
  });

  it('never advertises a non-existent --all command (P0 has no --all)', () => {
    expect(buildCronScope('/ws', false).hint).not.toContain('--all');
    expect(buildCronScope('/ws', true).hint).not.toContain('--all');
  });

  it('handles an empty/absent workspace path without a broken path placeholder', () => {
    const { scope, hint } = buildCronScope('', false);
    expect(scope.workspacePath).toBe('');
    expect(hint).toContain('(无活动工作区)');
    // Still tells the consumer how to scope to a real workspace.
    expect(hint).toContain('myagents cron list --workspace');
  });
});
