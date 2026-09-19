import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkLocalDocLinks } from './doc-links.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'myagents-doc-links-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs', '中文 guide.md'), '# Guide');
  return root;
}

test('finds broken inline, reference and image links with source locations', (t) => {
  const root = fixture(t);
  const failures = checkLocalDocLinks(root, 'docs/index.md', [
    '[inline](missing.md#owner)',
    '[reference][guide]',
    '![diagram](missing.png)',
    '',
    '[guide]: ../gone.md',
  ].join('\n'));
  assert.equal(failures.length, 3);
  assert.match(failures[0], /docs\/index.md:1:.*missing.md#owner/);
  assert.match(failures[1], /docs\/index.md:2:.*\.\.\/gone.md/);
  assert.match(failures[2], /docs\/index.md:3:.*missing.png/);
});

test('resolves encoded relative paths and ignores code examples and external scopes', (t) => {
  const root = fixture(t);
  const failures = checkLocalDocLinks(root, 'docs/index.md', [
    '[current](%E4%B8%AD%E6%96%87%20guide.md#owner)',
    '[title](<中文 guide.md> "Guide title")',
    '[remote](https://example.invalid/guide.md)',
    '[sibling](../../OtherRepo/CLAUDE.md)',
    '[fragment](#section)',
    '`[inline example](absent.md)`',
    '```md',
    '[fenced example](absent.md)',
    '```',
  ].join('\n'));
  assert.deepEqual(failures, []);
});

test('reports malformed URL escapes instead of crashing the audit', (t) => {
  const failures = checkLocalDocLinks(fixture(t), 'docs/index.md', '[bad](bad%ZZ.md)');
  assert.equal(failures.length, 1);
  assert.match(failures[0], /invalid URL encoding/);
});

test('uses the first reference definition, matching Markdown rendering', (t) => {
  const root = fixture(t);
  const validFirst = '[guide]\n\n[guide]: <中文 guide.md>\n[guide]: missing.md';
  assert.deepEqual(checkLocalDocLinks(root, 'docs/index.md', validFirst), []);
  const brokenFirst = '[guide]\n\n[guide]: missing.md\n[guide]: <中文 guide.md>';
  const failures = checkLocalDocLinks(root, 'docs/index.md', brokenFirst);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /missing local link target: missing.md/);
});
