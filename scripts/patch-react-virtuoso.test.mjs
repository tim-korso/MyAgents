import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { patchReactVirtuoso } from './patch-react-virtuoso.mjs';

const installed = resolve(import.meta.dirname, '../node_modules/react-virtuoso');
const names = ['index.mjs', 'index.cjs'];
const sources = names.map(name => readFileSync(resolve(installed, 'dist', name), 'utf8'));
const previous = source => source
  .replace('  const scrollExtent = A("totalListHeight") + A("deviation");\n', '')
  .replace('const scrollExtent=A("totalListHeight")+A("deviation");', '')
  .replace('children: [t, !s && G("div", { "data-virtuoso-scroll-extent": true, "aria-hidden": true, style: { position: "absolute", top: 0, height: scrollExtent, width: 1, pointerEvents: "none" } })]', 'children: t')
  .replace('children:[t,!s&&V.jsx("div",{"data-virtuoso-scroll-extent":true,"aria-hidden":true,style:{position:"absolute",top:0,height:scrollExtent,width:1,pointerEvents:"none"}})]', 'children:t');
const original = source => previous(source)
  .replace('      scrollBy: cancelOnScrollBy,\n', '')
  .replace('    Y(cancelOnScrollBy, S);\n', '')
  .replace('scrollBy:cancelOnScrollBy,', '')
  .replace('Y(cancelOnScrollBy,S);', '');
function fixture(run) {
  const directory = mkdtempSync(resolve(tmpdir(), 'myagents-virtuoso-patch-'));
  try {
    mkdirSync(resolve(directory, 'dist'));
    writeFileSync(resolve(directory, 'package.json'), JSON.stringify({ name: 'react-virtuoso', version: '4.18.3' }));
    names.forEach((name, index) => writeFileSync(resolve(directory, 'dist', name), original(sources[index])));
    run(directory);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('installed dependency is repaired before tests consume it', () => patchReactVirtuoso(installed, true));
test('repairs both module formats and accepts exact idempotent reruns', () => fixture(directory => {
  assert.throws(() => patchReactVirtuoso(directory, true), /npm run postinstall/);
  patchReactVirtuoso(directory);
  patchReactVirtuoso(directory);
  patchReactVirtuoso(directory, true);
  names.forEach((name, index) => assert.equal(readFileSync(resolve(directory, 'dist', name), 'utf8'), sources[index]));
}));
test('upgrades the previously installed cancellation patch without reinstalling', () => fixture(directory => {
  names.forEach((name, index) => writeFileSync(resolve(directory, 'dist', name), previous(sources[index])));
  assert.throws(() => patchReactVirtuoso(directory, true), /npm run postinstall/);
  patchReactVirtuoso(directory);
  patchReactVirtuoso(directory, true);
  names.forEach((name, index) => assert.equal(readFileSync(resolve(directory, 'dist', name), 'utf8'), sources[index]));
}));
test('rejects changed distribution bytes before modifying either module', () => fixture(directory => {
  writeFileSync(resolve(directory, 'dist/index.cjs'), 'unexpected source');
  assert.throws(() => patchReactVirtuoso(directory), /Unexpected react-virtuoso/);
  assert.equal(readFileSync(resolve(directory, 'dist/index.mjs'), 'utf8'), original(sources[0]));
}));
test('requires explicit review when the dependency version changes', () => fixture(directory => {
  writeFileSync(resolve(directory, 'package.json'), JSON.stringify({ name: 'react-virtuoso', version: '4.18.4' }));
  assert.throws(() => patchReactVirtuoso(directory), /Review the scroll regressions/);
  assert.equal(readFileSync(resolve(directory, 'dist/index.mjs'), 'utf8'), original(sources[0]));
}));
