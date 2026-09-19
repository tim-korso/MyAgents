import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { prepareCliproxy } from './prepare-cliproxy.mjs';

const source = JSON.parse(readFileSync(new URL('../src/shared/managed-cliproxy-source.json', import.meta.url)));
const bytes = Buffer.from('test artifact');
const sha256 = createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'cliproxy clean build '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src/shared'), { recursive: true });
  mkdirSync(join(root, '.github/cliproxy'), { recursive: true });
  writeFileSync(join(root, 'src/shared/managed-cliproxy-source.json'), JSON.stringify(source));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.4.17' }));
  const manifest = JSON.parse(readFileSync(new URL('../.github/cliproxy/manifest-v1.json', import.meta.url)));
  for (const platform of Object.keys(source.platforms)) {
    const a = manifest.releases[0].artifacts[platform];
    Object.assign(a, { sha256, size: bytes.length, url: `https://download.myagents.io/runtimes/cliproxy/${source.version}-${platform}-${sha256}.zip` });
  }
  writeFileSync(join(root, '.github/cliproxy/manifest-v1.json'), JSON.stringify(manifest));
  writeFileSync(join(root, '.github/cliproxy/manifest-v1.json.sig'), 'fixture signature; Rust verifies real signatures');
  return root;
}
for (const platform of Object.keys(source.platforms)) {
  test(`clean ${platform} build downloads pinned bytes and warm build is offline`, async t => {
    const repoRoot = fixture(t); let calls = 0;
    const options = { repoRoot, platform, distributionDir: '', fetchImpl: async () => { calls++; return new Response(bytes); } };
    await prepareCliproxy(options);
    assert.equal(calls, 1);
    const out = join(repoRoot, 'src-tauri/resources/cliproxy');
    assert.deepEqual(readFileSync(join(out, 'artifact.zip')), bytes);
    rmSync(out, { recursive: true });
    await prepareCliproxy({ ...options, fetchImpl: () => { throw new Error('offline'); } });
    assert.deepEqual(readFileSync(join(out, 'artifact.zip')), bytes);
    const cached = join(repoRoot, 'src-tauri/resources/cliproxy-cache/artifacts', `${sha256}.zip`);
    writeFileSync(cached, 'corrupt');
    await prepareCliproxy(options);
    assert.equal(calls, 2);
  });
}
test('download failure does not replace staged bundle; next attempt can succeed', async t => {
  const repoRoot = fixture(t); const platform = 'win32-x64';
  const out = join(repoRoot, 'src-tauri/resources/cliproxy'); mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'artifact.zip'), 'previous');
  await assert.rejects(prepareCliproxy({ repoRoot, platform, distributionDir: '', fetchImpl: async () => new Response('bad') }), /integrity|size/);
  assert.equal(readFileSync(join(out, 'artifact.zip'), 'utf8'), 'previous');
  await prepareCliproxy({ repoRoot, platform, distributionDir: '', fetchImpl: async () => new Response(bytes) });
  assert.deepEqual(readFileSync(join(out, 'artifact.zip')), bytes);
});
test('explicit distribution is offline and never silently falls back to network', async t => {
  const repoRoot = fixture(t); const distributionDir = join(repoRoot, 'custom distribution');
  cpSync(join(repoRoot, '.github/cliproxy'), distributionDir, { recursive: true });
  const options = { repoRoot, platform: 'win32-x64', distributionDir, fetchImpl: () => { throw new Error('unexpected network'); } };
  await assert.rejects(prepareCliproxy(options), /ENOENT/);
  const name = `${source.version}-win32-x64-${sha256}.zip`;
  writeFileSync(join(distributionDir, name), bytes);
  await prepareCliproxy(options);
  writeFileSync(join(distributionDir, name), 'bad');
  await assert.rejects(prepareCliproxy(options), /integrity/);
});

test('one invocation recovers from a transient response and caches only the successful payload', async t => {
  const repoRoot = fixture(t);
  let calls = 0;
  await prepareCliproxy({ repoRoot, platform: 'win32-x64', fetchImpl: async () => {
    calls++;
    return calls === 1 ? new Response('busy', { status: 503 }) : new Response(bytes);
  } });
  assert.equal(calls, 2);
  await prepareCliproxy({ repoRoot, platform: 'win32-x64', fetchImpl: async () => { throw new Error('must use cache'); } });
  assert.deepEqual(readFileSync(join(repoRoot, 'src-tauri/resources/cliproxy/artifact.zip')), bytes);
});
