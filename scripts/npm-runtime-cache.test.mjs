import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { prepareNpmRuntime, runtimeLock } from './npm-runtime-cache.mjs';
import { validateRuntimeBinary, validateTsxRuntime } from './npm-runtime-validation.mjs';

const put = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); };
const json = (path, value) => put(path, JSON.stringify(value));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'myagents-npm-cache-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  json(join(root, 'package.json'), { version: '0.4.18', devDependencies: { tsx: '4.21.0' } });
  const lock = { lockfileVersion: 3, packages: {
    '': { devDependencies: { tsx: '4.21.0' } },
    'node_modules/tsx': { version: '4.21.0', dev: true, dependencies: { esbuild: '~0.27.0' } },
    'node_modules/tsx/node_modules/esbuild': { version: '0.27.7', dev: true },
    'node_modules/unrelated': { version: '1.0.0' },
  } };
  const saveLock = () => json(join(root, 'package-lock.json'), lock);
  saveLock();
  let installs = 0;
  const logs = [];
  const options = {
    projectRoot: root, name: 'tsx', os: 'linux', cpu: 'x64', implementationFiles: [],
    install: (payload, os, cpu) => {
      installs++;
      put(join(payload, 'node_modules/runtime.js'), `${os}-${cpu}`);
      put(join(payload, 'node_modules/tsx/package.json'), JSON.stringify({ version: '4.21.0' }));
      if (process.platform !== 'win32') {
        mkdirSync(join(payload, 'node_modules/.bin'));
        symlinkSync('../runtime.js', join(payload, 'node_modules/.bin/runtime'));
      }
    },
    validate: (payload, os, cpu) => assert.equal(readFileSync(join(payload, 'node_modules/runtime.js'), 'utf8'), `${os}-${cpu}`),
    log: text => logs.push(text),
  };
  const prepare = extra => prepareNpmRuntime({ ...options, ...extra });
  return { root, lock, saveLock, options, prepare, logs, installs: () => installs };
}

test('cold install then verified warm reuse; signing projection is independent', async t => {
  const f = fixture(t);
  const cold = await f.prepare();
  assert.equal(cold.cacheHit, false);
  // Stand in for codesign altering the staged native file.
  put(join(cold.root, 'node_modules/runtime.js'), 'signed copy');
  put(join(cold.root, 'unwanted'), 'old target');
  const warm = await f.prepare();
  assert.equal(warm.cacheHit, true);
  assert.equal(f.installs(), 1);
  assert.equal(readFileSync(join(warm.root, 'node_modules/runtime.js'), 'utf8'), 'linux-x64');
  assert.equal(existsSync(join(warm.root, 'unwanted')), false);
  assert.match(f.logs.join('\n'), /MISS:.*\n.*STAGED:.*\n.*HIT:/);
});

test('target caches are isolated and switching back reuses the original target', async t => {
  const f = fixture(t);
  await f.prepare();
  const arm = await f.prepare({ cpu: 'arm64' });
  assert.equal(arm.cacheHit, false);
  assert.equal(readFileSync(join(arm.root, 'node_modules/runtime.js'), 'utf8'), 'linux-arm64');
  assert.equal((await f.prepare()).cacheHit, true);
  assert.equal(f.installs(), 2);
});

test('transitive lock upgrade invalidates cache, unrelated dependency/app version does not', async t => {
  const f = fixture(t);
  await f.prepare();
  f.lock.packages['node_modules/unrelated'].version = '2.0.0';
  f.saveLock();
  json(join(f.root, 'package.json'), { version: '0.4.19', devDependencies: { tsx: '4.21.0' } });
  assert.equal((await f.prepare()).cacheHit, true);
  f.lock.packages['node_modules/tsx/node_modules/esbuild'].version = '0.27.8';
  f.saveLock();
  assert.equal((await f.prepare()).cacheHit, false);
  assert.equal(f.installs(), 2);
});

test('locked closure retains nested resolution and rejects missing or drifting dependencies', t => {
  const f = fixture(t);
  const lock = runtimeLock(f.root, 'tsx');
  assert.equal(lock.packages['node_modules/tsx/node_modules/esbuild'].version, '0.27.7');
  assert.equal(lock.packages['node_modules/tsx'].dev, undefined);
  assert.equal(lock.packages['node_modules/unrelated'], undefined);
  delete f.lock.packages['node_modules/tsx/node_modules/esbuild']; f.saveLock();
  assert.throws(() => runtimeLock(f.root, 'tsx'), /Missing locked esbuild/);
  f.lock.packages['node_modules/tsx'].version = '4.22.0';
  f.lock.packages['node_modules/tsx'].dependencies = {}; f.saveLock();
  assert.throws(() => runtimeLock(f.root, 'tsx'), /version mismatch/);
});

test('corrupt cache re-installs; failed replacement leaves the previous projection usable', async t => {
  const f = fixture(t);
  await f.prepare();
  // Derive the cache path from the actual published directory tree.
  const { readdirSync } = await import('node:fs');
  const target = join(f.root, 'src-tauri/resources/npm-runtime-cache/tsx/linux-x64');
  const cache = join(target, readdirSync(target)[0]);
  put(join(cache, 'payload/node_modules/runtime.js'), 'corrupt');
  await assert.rejects(f.prepare({ install: () => { throw new Error('npm failed'); } }), /npm failed/);
  assert.equal(readFileSync(join(f.root, 'src-tauri/resources/tsx-runtime/node_modules/runtime.js'), 'utf8'), 'linux-x64');
  assert.equal((await f.prepare()).cacheHit, false);
  assert.equal(f.installs(), 2);
  assert.match(f.logs.join('\n'), /cache validation failed/);
});

test('concurrent preparation waits and installs only once', async t => {
  const f = fixture(t);
  const install = async (...args) => {
    await new Promise(done => setTimeout(done, 40));
    f.options.install(...args);
  };
  const results = await Promise.all([f.prepare({ install }), f.prepare({ install })]);
  assert.deepEqual(results.map(result => result.cacheHit), [false, true]);
  assert.equal(f.installs(), 1);
});

test('validation failure or unsafe symlink never publishes a partial runtime', async t => {
  const f = fixture(t);
  await f.prepare();
  await assert.rejects(f.prepare({ cpu: 'arm64', validate: () => { throw new Error('wrong architecture'); } }), /wrong architecture/);
  if (process.platform !== 'win32') {
    await assert.rejects(f.prepare({ cpu: 'arm64', install: (...args) => {
      f.options.install(...args);
      symlinkSync('/outside', join(args[0], 'escape'));
    } }), /symlink escapes/);
  }
  assert.equal((await f.prepare()).cacheHit, true);
});

test('cache detects additional files and executable permission changes', async t => {
  const f = fixture(t);
  await f.prepare();
  const { readdirSync, chmodSync } = await import('node:fs');
  const target = join(f.root, 'src-tauri/resources/npm-runtime-cache/tsx/linux-x64');
  const cache = join(target, readdirSync(target)[0], 'payload');
  put(join(cache, 'extra'), 'not in inventory');
  assert.equal((await f.prepare()).cacheHit, false);
  if (process.platform !== 'win32') {
    chmodSync(join(cache, 'node_modules/runtime.js'), 0o755);
    assert.equal((await f.prepare()).cacheHit, false);
  }
});

test('native validation rejects wrong architecture and truncated PE for every supported OS', t => {
  const root = mkdtempSync(join(tmpdir(), 'myagents-binary-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const os of ['darwin', 'linux', 'win32']) {
    const bytes = Buffer.alloc(128);
    if (os === 'darwin') { bytes.writeUInt32LE(0xfeedfacf); bytes.writeUInt32LE(0x01000007, 4); }
    if (os === 'linux') { bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]); bytes.writeUInt16LE(62, 18); }
    if (os === 'win32') { bytes.write('MZ'); bytes.writeUInt32LE(64, 0x3c); bytes.writeUInt32LE(0x4550, 64); bytes.writeUInt16LE(0x8664, 68); }
    const path = join(root, os); put(path, bytes);
    validateRuntimeBinary(path, os, 'x64');
    assert.throws(() => validateRuntimeBinary(path, os, 'arm64'), /Wrong or invalid/);
    put(path, bytes.subarray(0, 20));
    assert.throws(() => validateRuntimeBinary(path, os, 'x64'), /Wrong or invalid/);
  }
});


test('tsx host validation loads from a filesystem path with spaces and URL fragments', t => {
  const root = mkdtempSync(join(tmpdir(), 'myagents runtime #fragment-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const require = createRequire(import.meta.url);
  const platform = `${process.platform}-${process.arch}`;
  const packageRoot = dirname(require.resolve(`@esbuild/${platform}/package.json`));
  const binary = process.platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild';
  const target = join(root, 'node_modules/@esbuild', platform, binary);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(packageRoot, binary), target);
  put(join(root, 'node_modules/tsx/dist/esm/index.mjs'), '// Isolate Node --import path handling from tsx behavior.');
  json(join(root, 'package.json'), { name: 'myagents-tsx-runtime' });
  validateTsxRuntime(root, process.platform, process.arch);
});
