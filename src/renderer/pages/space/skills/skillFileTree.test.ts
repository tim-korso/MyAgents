import { describe, expect, it } from 'vitest';

import type { SpaceSkillFile } from '@/api/spaceCloud';
import { createSkillFileTreeRows } from './skillFileTree';

function file(path: string, isDir = false): SpaceSkillFile {
  const parts = path.split('/');
  return {
    id: path,
    path,
    name: parts.at(-1) ?? path,
    parentPath: parts.length > 1 ? parts.slice(0, -1).join('/') : '',
    isDir,
    sizeBytes: isDir ? null : 1,
    mimeType: isDir ? null : 'text/plain',
    createdAt: '2026-01-01T00:00:00Z',
  };
}

describe('createSkillFileTreeRows', () => {
  const files = [
    file('SKILL.md'),
    file('agents', true),
    file('agents/openai.yaml'),
    file('references', true),
    file('references/qa-rubric.md'),
    file('references/nested', true),
    file('references/nested/checklist.md'),
  ];

  it('keeps folders collapsed by default', () => {
    expect(createSkillFileTreeRows(files, new Set()).map((row) => row.file.path)).toEqual([
      'agents',
      'references',
      'SKILL.md',
    ]);
  });

  it('reveals direct children when a folder is expanded', () => {
    expect(createSkillFileTreeRows(files, new Set(['references'])).map((row) => row.file.path)).toEqual([
      'agents',
      'references',
      'references/nested',
      'references/qa-rubric.md',
      'SKILL.md',
    ]);
  });

  it('reveals nested children only when each ancestor is expanded', () => {
    expect(createSkillFileTreeRows(files, new Set(['references', 'references/nested'])).map((row) => row.file.path)).toEqual([
      'agents',
      'references',
      'references/nested',
      'references/nested/checklist.md',
      'references/qa-rubric.md',
      'SKILL.md',
    ]);
  });

  it('includes orphaned paths defensively', () => {
    const rows = createSkillFileTreeRows([file('missing/child.md')], new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      depth: 1,
      file: { path: 'missing/child.md' },
    });
  });
});
