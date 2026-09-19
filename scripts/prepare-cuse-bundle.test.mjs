import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { cusePlatform, FEED, prepareCuseBundle as prepareCuseBundleImpl } from './prepare-cuse-bundle.mjs';

const prepareCuseBundle = options => prepareCuseBundleImpl({ ...options, cacheRoot: join(dirname(options.destination), 'cache') });

const digest = bytes => ({ size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
function release(platform, version = '0.3.0', mutate = () => {}) {
  const entrypoint = platform === 'macos-universal' ? 'scripts/cuse' : 'scripts/cuse.exe';
  const payload = { 'SKILL.md': Buffer.from('---\nname: cuse\ndescription: desktop\n---'), LICENSE: Buffer.from('license'), [entrypoint]: Buffer.from('binary ' + version), 'references/setup.md': Buffer.from('setup') };
  const meta = { schema_version: 1, name: 'cuse', kind: 'skill', platform, version, source_commit: 'a'.repeat(40), entrypoint, args: [], files: Object.fromEntries(Object.entries(payload).map(([name, bytes]) => [name, digest(bytes)])) };
  const zip = new AdmZip();
  for (const [name, bytes] of Object.entries(payload)) zip.addFile(`cuse/${name}`, bytes, '', name === entrypoint ? 0o100755 : 0o100644);
  zip.addFile('cuse/package.json', Buffer.from(JSON.stringify(meta)), '', 0o100644);
  mutate(zip, meta);
  const bytes = zip.toBuffer();
  const prefix = `${FEED}/releases/v${version}`;
  const artifact = { url: `${prefix}/cuse-skill-v${version}-${platform}.zip`, ...digest(bytes) };
  const manifest = Buffer.from(JSON.stringify({ schema_version: 1, version, source_commit: meta.source_commit, packages: { skill: { [platform]: artifact } } }));
  const pointer = Buffer.from(JSON.stringify({ schema_version: 1, version, manifest: { url: `${prefix}/manifest.json`, ...digest(manifest) } }));
  const resources = new Map([[`${FEED}/latest.json`, pointer], [`${prefix}/manifest.json`, manifest], [artifact.url, bytes]]);
  const requests = [];
  return { resources, requests, fetchBytes: async url => { requests.push(url); assert.ok(resources.has(url)); return resources.get(url); } };
}
function context(t) {
  const root = mkdtempSync(join(tmpdir(), 'myagents-cuse-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return join(root, 'cuse');
}

for (const [target, platform] of [['aarch64-apple-darwin', 'macos-universal'], ['x86_64-pc-windows-msvc', 'windows-x64']]) {
  test(`${platform}: install, verified hit, repair, update`, async t => {
    const destination = context(t);
    const source = release(platform);
    const options = { target, destination, fetchBytes: source.fetchBytes, log() {} };
    assert.equal((await prepareCuseBundle(options)).updated, true);
    assert.equal((await prepareCuseBundle(options)).updated, false);
    assert.equal(source.requests.filter(url => url.endsWith('.zip')).length, 1);
    rmSync(join(destination, 'references/setup.md'));
    assert.equal((await prepareCuseBundle(options)).updated, true);
    writeFileSync(join(destination, 'SKILL.md'), 'corrupt');
    assert.equal((await prepareCuseBundle(options)).updated, true);
    assert.equal(source.requests.filter(url => url.endsWith('.zip')).length, 1, 'repairs must reuse the pristine archive');
    const next = release(platform, '0.3.1');
    assert.equal((await prepareCuseBundle({ ...options, fetchBytes: next.fetchBytes })).version, '0.3.1');
    assert.equal(JSON.parse(readFileSync(join(destination, 'package.json'))).version, '0.3.1');
  });
}

test('Mac executable permissions are repaired', { skip: process.platform === 'win32' }, async t => {
  const destination = context(t);
  const source = release('macos-universal');
  const options = { target: 'x86_64-apple-darwin', destination, fetchBytes: source.fetchBytes, log() {} };
  await prepareCuseBundle(options);
  chmodSync(join(destination, 'scripts/cuse'), 0o644);
  assert.equal((await prepareCuseBundle(options)).updated, true);
});

for (const [label, mutate] of [
  ['traversal', zip => zip.addFile('cuse/../escape', Buffer.from('x'), '', 0o100644)],
  ['symlink', zip => zip.addFile('cuse/link', Buffer.from('/tmp'), '', 0o120777)],
  ['case collision', zip => zip.addFile('cuse/skill.md', Buffer.from('x'), '', 0o100644)],
  ['extra payload', zip => zip.addFile('cuse/extra', Buffer.from('x'), '', 0o100644)],
  ['wrong platform', (zip, meta) => { meta.platform = 'windows-x64'; zip.updateFile('cuse/package.json', Buffer.from(JSON.stringify(meta))); }],
  ['wrong inventory hash', zip => zip.updateFile('cuse/SKILL.md', Buffer.from('wrong'))],
]) {
  test(`rejects ${label} and preserves existing bundle`, async t => {
    const destination = context(t);
    mkdirSync(destination);
    writeFileSync(join(destination, 'keep'), 'old');
    const source = release('macos-universal', '0.3.0', mutate);
    await assert.rejects(prepareCuseBundle({ target: 'aarch64-apple-darwin', destination, fetchBytes: source.fetchBytes, log() {} }));
    assert.equal(readFileSync(join(destination, 'keep'), 'utf8'), 'old');
  });
}

test('network failure cannot silently reuse stale resource', async t => {
  const destination = context(t);
  mkdirSync(destination); writeFileSync(join(destination, 'keep'), 'old');
  await assert.rejects(prepareCuseBundle({ target: 'aarch64-apple-darwin', destination, fetchBytes: async () => { throw new Error('offline'); } }), /offline/);
  assert.equal(readFileSync(join(destination, 'keep'), 'utf8'), 'old');
});

test('rejects artifact hash corruption before extraction', async t => {
  const source = release('macos-universal');
  const zipUrl = [...source.resources.keys()].find(url => url.endsWith('.zip'));
  source.resources.set(zipUrl, Buffer.from('corrupted download'));
  const destination = context(t);
  await assert.rejects(prepareCuseBundle({ target: 'aarch64-apple-darwin', destination, fetchBytes: source.fetchBytes }), /digest mismatch/);
  assert.equal(existsSync(destination), false);
});

test('target is explicit; Linux removes previous native bundle without network', async t => {
  assert.throws(() => cusePlatform(undefined), /explicit/);
  assert.throws(() => cusePlatform('aarch64-pc-windows-msvc'), /Unsupported/);
  const destination = context(t);
  mkdirSync(destination); writeFileSync(join(destination, 'old-mac-binary'), 'x');
  await prepareCuseBundle({ target: 'x86_64-unknown-linux-gnu', destination, fetchBytes: () => { throw new Error('must not download'); }, log() {} });
  assert.equal(existsSync(destination), false);
});

test('signed Mac projection restores from verified archive without another ZIP request', async t => {
  const destination = context(t);
  const source = release('macos-universal');
  const options = { target: 'aarch64-apple-darwin', destination, fetchBytes: source.fetchBytes, log() {} };
  await prepareCuseBundle(options);
  writeFileSync(join(destination, 'scripts/cuse'), 'changed by Developer ID signature');
  await prepareCuseBundle({ ...options, target: 'x86_64-apple-darwin' });
  assert.equal(source.requests.filter(url => url.endsWith('.zip')).length, 1);
  assert.equal(readFileSync(join(destination, 'scripts/cuse'), 'utf8'), 'binary 0.3.0');
  assert.equal(source.requests.filter(url => url.endsWith('/latest.json')).length, 2);
});

test('corrupt archive is reacquired; failed download preserves the signed projection', async t => {
  const destination = context(t);
  const source = release('macos-universal');
  const options = { target: 'aarch64-apple-darwin', destination, fetchBytes: source.fetchBytes, log() {} };
  await prepareCuseBundle(options);
  const [zipUrl, zipBytes] = [...source.resources].find(([url]) => url.endsWith('.zip'));
  const cache = join(dirname(destination), 'cache/downloads', `${digest(zipBytes).sha256}-cuse-macos-universal.zip`);
  writeFileSync(cache, 'corrupt');
  writeFileSync(join(destination, 'scripts/cuse'), 'signed');
  await assert.rejects(prepareCuseBundle({ ...options, fetchBytes: async url => {
    if (url === zipUrl) throw new Error('offline');
    return source.fetchBytes(url);
  } }), /offline/);
  assert.equal(readFileSync(join(destination, 'scripts/cuse'), 'utf8'), 'signed');
  await prepareCuseBundle(options);
  assert.equal(source.requests.filter(url => url === zipUrl).length, 2);
  assert.deepEqual(readFileSync(cache), zipBytes);
});
