import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { patchCodeMirrorView } from './patch-codemirror-view.mjs';

const installed = resolve(import.meta.dirname, '../node_modules/@codemirror/view');
const names = ['index.js', 'index.cjs'];
const sources = names.map(name => readFileSync(resolve(installed, 'dist', name), 'utf8'));
const original = source => source
  .replace('let contentWidth = domRect.width, oldContentWidth = this.contentDOMWidth;', 'let contentWidth = domRect.width;')
  .replace('Math.abs(contentWidth - oldContentWidth) > oracle.charWidth', 'Math.abs(contentWidth - this.contentDOMWidth) > oracle.charWidth')
  .replace(' || lineWrapping && this.lineLength != lineLength;', ';');
function fixture(run) {
  const directory = mkdtempSync(resolve(tmpdir(), 'myagents-cm-patch-'));
  try {
    mkdirSync(resolve(directory, 'dist'));
    writeFileSync(resolve(directory, 'package.json'), JSON.stringify({ name: '@codemirror/view', version: '6.43.11' }));
    names.forEach((name, index) => writeFileSync(resolve(directory, 'dist', name), original(sources[index])));
    run(directory);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('installed dependency is repaired before tests consume it', () => patchCodeMirrorView(installed, true));
test('repairs both module formats and accepts exact idempotent reruns', () => fixture(directory => {
  assert.throws(() => patchCodeMirrorView(directory, true), /npm run postinstall/);
  patchCodeMirrorView(directory);
  patchCodeMirrorView(directory);
  patchCodeMirrorView(directory, true);
  names.forEach((name, index) => assert.equal(readFileSync(resolve(directory, 'dist', name), 'utf8'), sources[index]));
}));
test('rejects changed distribution bytes before modifying either module', () => fixture(directory => {
  writeFileSync(resolve(directory, 'dist/index.cjs'), 'unexpected source');
  assert.throws(() => patchCodeMirrorView(directory), /Unexpected CodeMirror/);
  assert.equal(readFileSync(resolve(directory, 'dist/index.js'), 'utf8'), original(sources[0]));
}));
test('requires explicit review when the dependency version changes', () => fixture(directory => {
  writeFileSync(resolve(directory, 'package.json'), JSON.stringify({ name: '@codemirror/view', version: '6.43.12' }));
  assert.throws(() => patchCodeMirrorView(directory), /Review the upstream fix/);
  assert.equal(readFileSync(resolve(directory, 'dist/index.js'), 'utf8'), original(sources[0]));
}));
