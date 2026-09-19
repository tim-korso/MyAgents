import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CLI_TOOL_PROMPT_MAX_TOOLS } from '../../shared/types/cliTools';
import {
  buildLauncherSource,
  buildUserToolsSectionText,
  findMissingEnvKeys,
  assertCliToolTreeSelfContained,
  readCliToolManifest,
} from './cli-tools-registry';

describe('buildUserToolsSectionText', () => {
  it('returns empty string for no tools (section must not appear at all)', () => {
    expect(buildUserToolsSectionText([])).toBe('');
  });

  it('renders one block per tool inside the tagged section', () => {
    const text = buildUserToolsSectionText([
      { name: 'md-merge', description: '合并 Markdown。' },
      { name: 'video-brief', description: '视频理解。' },
    ]);
    expect(text).toContain('<myagents-user-tools>');
    expect(text).toContain('</myagents-user-tools>');
    expect(text).toContain('## md-merge');
    expect(text).toContain('## video-brief');
    expect(text).not.toContain('…and');
  });

  it('caps at CLI_TOOL_PROMPT_MAX_TOOLS and degrades the rest to a list hint (fuse)', () => {
    const tools = Array.from({ length: CLI_TOOL_PROMPT_MAX_TOOLS + 5 }, (_, i) => ({
      name: `tool-${i}`,
      description: `desc ${i}`,
    }));
    const text = buildUserToolsSectionText(tools);
    expect(text).toContain(`## tool-${CLI_TOOL_PROMPT_MAX_TOOLS - 1}`);
    expect(text).not.toContain(`## tool-${CLI_TOOL_PROMPT_MAX_TOOLS}`);
    expect(text).toContain('…and 5 more registered tool(s)');
    expect(text).toContain('myagents tool list');
  });
});

describe('buildLauncherSource', () => {
  it('embeds name and entry path as JSON (safe against spaces/quotes in paths)', () => {
    const src = buildLauncherSource('md-merge', '/Users/x y/.myagents/tools/md-merge/run.mjs');
    expect(src).toContain('"/Users/x y/.myagents/tools/md-merge/run.mjs"');
    expect(src.startsWith('#!/usr/bin/env node\n')).toBe(true);
    // CJS：POSIX shim 无扩展名，node 按 CJS 解释（bin 目录无 package.json）
    expect(src).toContain("require('node:child_process')");
    expect(src).not.toMatch(/^import /m);
  });
});

describe('findMissingEnvKeys', () => {
  it('reports declared-but-unconfigured keys', () => {
    expect(findMissingEnvKeys({ name: 't', envKeys: ['A', 'B'] }, { t: { A: 'v' } })).toEqual(['B']);
  });
  it('treats empty values as missing', () => {
    expect(findMissingEnvKeys({ name: 't', envKeys: ['A'] }, { t: { A: '' } })).toEqual(['A']);
  });
  it('returns empty for tools without envKeys', () => {
    expect(findMissingEnvKeys({ name: 't', envKeys: [] }, undefined)).toEqual([]);
    expect(findMissingEnvKeys({ name: 't', envKeys: undefined }, undefined)).toEqual([]);
  });
});

describe('readCliToolManifest', () => {
  const dirs: string[] = [];
  const makeToolDir = (manifest: unknown, opts?: { skipEntryFile?: boolean }): string => {
    const dir = mkdtempSync(join(tmpdir(), 'myagents-clitool-test-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'tool.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
    if (!opts?.skipEntryFile) writeFileSync(join(dir, 'run.mjs'), '// entry');
    return dir;
  };
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it('reads and validates a well-formed tool dir', () => {
    const dir = makeToolDir({ name: 'md-merge', description: 'd', entry: 'run.mjs' });
    const r = readCliToolManifest(dir);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.name).toBe('md-merge');
  });

  it('fails with MANIFEST_NOT_FOUND for a dir without tool.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'myagents-clitool-test-'));
    dirs.push(dir);
    const r = readCliToolManifest(dir);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('MANIFEST_NOT_FOUND');
  });

  it('fails with MANIFEST_PARSE_ERROR for invalid JSON', () => {
    const dir = makeToolDir('{not json');
    const r = readCliToolManifest(dir);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('MANIFEST_PARSE_ERROR');
  });

  it('fails with ENTRY_NOT_FOUND when entry script is missing', () => {
    const dir = makeToolDir({ name: 'md-merge', description: 'd', entry: 'run.mjs' }, { skipEntryFile: true });
    const r = readCliToolManifest(dir);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('ENTRY_NOT_FOUND');
  });

  it('propagates validation errors (e.g. reserved name)', () => {
    const dir = makeToolDir({ name: 'curl', description: 'd', entry: 'run.mjs' });
    const r = readCliToolManifest(dir);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NAME_RESERVED');
  });

  it('rejects non-entry symlinks in the tool tree', () => {
    const dir = makeToolDir({ name: 'md-merge', description: 'd', entry: 'run.mjs' });
    const target = join(dir, 'real-secret.txt');
    writeFileSync(target, 'secret');
    try {
      symlinkSync(target, join(dir, 'secret-link.txt'));
    } catch {
      // Some Windows CI environments disallow symlink creation for non-admin users.
      return;
    }
    expect(() => assertCliToolTreeSelfContained(dir)).toThrow(/symlink/i);
  });
});
