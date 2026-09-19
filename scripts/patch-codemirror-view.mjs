// Temporary, version-bound repair for CM's wrapped long-line gaps after resize.
// Remove this script/hooks when an upstream release passes the regression in
// specs/tech_docs/workspace_markdown_editor.md. No runtime/private-API override.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const hashes = {
  'index.js': ['7a65aa46b3e16a1142fceec6d5ed65cf7fc944afaa4f6bcd4e52ba3d0151e2ea', '80c3886788b92b7bccada11f9da05f0f55bbdbba60ab6cf9985c98aa987d2eef'],
  'index.cjs': ['80fbec493e959b8c958926cab4e9619bb2c1cba966fe4ace2a9d7b8b49965f06', 'f3d14bafa953b4fbf58f1b0867b17287d8704940c65ab21f0a17cd9a371055df'],
};
const changes = [
  // Compare with the previous width, before measure() replaces the stored one.
  ['let contentWidth = domRect.width;', 'let contentWidth = domRect.width, oldContentWidth = this.contentDOMWidth;'],
  ['Math.abs(contentWidth - this.contentDOMWidth) > oracle.charWidth', 'Math.abs(contentWidth - oldContentWidth) > oracle.charWidth'],
  // The gap sizes and height map depend on wrapping width, even at the same font size.
  ['let changed = Math.abs(lineHeight - this.lineHeight) > 0.3 || this.lineWrapping != lineWrapping;',
    'let changed = Math.abs(lineHeight - this.lineHeight) > 0.3 || this.lineWrapping != lineWrapping || lineWrapping && this.lineLength != lineLength;'],
];
const digest = source => createHash('sha256').update(source).digest('hex');

export function patchCodeMirrorView(directory, check = false) {
  const metadata = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
  if (metadata.name !== '@codemirror/view' || metadata.version !== '6.43.11') {
    throw new Error('CodeMirror resize repair requires @codemirror/view 6.43.11. Review the upstream fix before changing this pin.');
  }
  // Validate both module formats before modifying either; reruns accept only
  // exact published or exact repaired bytes, never an approximate patch match.
  const pending = Object.entries(hashes).flatMap(([name, [original, repaired]]) => {
    const path = resolve(directory, 'dist', name), source = readFileSync(path, 'utf8'), hash = digest(source);
    if (hash === repaired) return [];
    if (hash !== original) throw new Error(`Unexpected CodeMirror ${name} bytes. Reinstall dependencies and review the resize repair.`);
    if (check) throw new Error('CodeMirror resize repair is missing. Run npm run postinstall (also required after --ignore-scripts).');
    const result = changes.reduce((text, [before, after]) => text.replace(before, after), source);
    if (digest(result) !== repaired) throw new Error(`CodeMirror ${name} repair did not produce the reviewed bytes.`);
    return [{ path, result }];
  });
  for (const { path, result } of pending) writeFileSync(path, result);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  patchCodeMirrorView(resolve(import.meta.dirname, '../node_modules/@codemirror/view'), process.argv.includes('--check'));
}
