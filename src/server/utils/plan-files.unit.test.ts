import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  SESSION_PLANS_GITIGNORE_PATTERN,
  clearSessionPlanMarkdown,
  getSessionPlansDirectoryPath,
  getSessionPlansDirectorySetting,
  readLatestPlanMarkdown,
  readLatestPlanMarkdownWithRetry,
  sanitizePlanSessionSegment,
} from './plan-files';

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'myagents-plan-files-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('session plan files', () => {
  it('uses a sanitized session-scoped plansDirectory setting', () => {
    expect(sanitizePlanSessionSegment('sid/../bad:value')).toBe('sid_bad_value');
    expect(getSessionPlansDirectorySetting('sid/../bad:value')).toBe('.claude/plans/myagents/sid_bad_value');
    expect(getSessionPlansDirectoryPath('/workspace', 'sid/../bad:value')).toContain(join('.claude', 'plans', 'myagents', 'sid_bad_value'));
    expect(SESSION_PLANS_GITIGNORE_PATTERN).toBe('.claude/plans/myagents/');
  });

  it('reads the latest markdown plan newer than the current-turn cutoff', async () => {
    const root = makeRoot();
    const dir = join(root, '.claude', 'plans', 'myagents', 'session-1');
    mkdirSync(dir, { recursive: true });

    const stale = join(dir, 'stale.md');
    const current = join(dir, 'current.md');
    const ignored = join(dir, 'notes.txt');
    writeFileSync(stale, 'stale plan');
    writeFileSync(current, 'current plan');
    writeFileSync(ignored, 'not a markdown plan');

    const cutoff = new Date('2026-06-15T00:00:00.000Z');
    utimesSync(stale, cutoff, new Date(cutoff.getTime() - 1000));
    utimesSync(current, cutoff, new Date(cutoff.getTime() + 1000));

    const result = await readLatestPlanMarkdown(dir, {
      minMtimeMs: cutoff.getTime(),
      expectedRoot: root,
    });

    expect(result?.path).toBe(current);
    expect(result?.content).toBe('current plan');
    expect(result?.truncated).toBe(false);
  });

  it('retries briefly for a plan file created during approval handoff', async () => {
    const dir = join(makeRoot(), '.claude', 'plans', 'myagents', 'session-1');
    mkdirSync(dir, { recursive: true });

    const pending = readLatestPlanMarkdownWithRetry(dir, { attempts: 3, delayMs: 10 });
    setTimeout(() => writeFileSync(join(dir, 'later.md'), 'later plan'), 1);

    const result = await pending;

    expect(result?.content).toBe('later plan');
  });

  it('ignores symlink leaves instead of following them', async () => {
    const root = makeRoot();
    const dir = join(root, '.claude', 'plans', 'myagents', 'session-1');
    mkdirSync(dir, { recursive: true });
    const target = join(root, 'secret.md');
    writeFileSync(target, 'secret');

    try {
      symlinkSync(target, join(dir, 'plan.md'));
    } catch {
      return;
    }

    await expect(readLatestPlanMarkdown(dir)).resolves.toBeNull();
  });

  it('does not read a plans directory symlink that resolves outside the expected root', async () => {
    const root = makeRoot();
    const outside = makeRoot();
    const parent = join(root, '.claude', 'plans', 'myagents');
    const dir = join(parent, 'session-1');
    mkdirSync(parent, { recursive: true });
    writeFileSync(join(outside, 'outside.md'), 'do not read');

    try {
      symlinkSync(outside, dir, 'dir');
    } catch {
      return;
    }

    await expect(readLatestPlanMarkdown(dir, { expectedRoot: root })).resolves.toBeNull();
    await expect(readLatestPlanMarkdownWithRetry(dir, { expectedRoot: root, attempts: 1 })).resolves.toBeNull();
  });

  it('truncates large plan files before they enter SSE payloads', async () => {
    const dir = join(makeRoot(), '.claude', 'plans', 'myagents', 'session-1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'big.md'), Buffer.alloc(129 * 1024, 'a'));

    const result = await readLatestPlanMarkdown(dir);

    expect(result?.truncated).toBe(true);
    expect(result?.content).toContain('Plan content truncated');
    expect(result?.content.length).toBeLessThan(132_000);
  });

  it('clears stale markdown plans without touching non-markdown files', async () => {
    const dir = join(makeRoot(), '.claude', 'plans', 'myagents', 'session-1');
    mkdirSync(dir, { recursive: true });
    const stale = join(dir, 'stale.md');
    const note = join(dir, 'note.txt');
    writeFileSync(stale, 'old');
    writeFileSync(note, 'keep');

    await clearSessionPlanMarkdown(dir);

    await expect(readLatestPlanMarkdown(dir)).resolves.toBeNull();
    expect(existsSync(note)).toBe(true);
    await expect(readLatestPlanMarkdown(join(dir, 'missing'))).resolves.toBeNull();
  });

  it('does not clear a plans directory that resolves outside the expected root', async () => {
    const root = makeRoot();
    const outside = makeRoot();
    const parent = join(root, '.claude', 'plans', 'myagents');
    const dir = join(parent, 'session-1');
    mkdirSync(parent, { recursive: true });
    const outsidePlan = join(outside, 'outside.md');
    writeFileSync(outsidePlan, 'keep');

    try {
      symlinkSync(outside, dir, 'dir');
    } catch {
      return;
    }

    await clearSessionPlanMarkdown(dir, { expectedRoot: root });

    expect(existsSync(outsidePlan)).toBe(true);
  });
});
