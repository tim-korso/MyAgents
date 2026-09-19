import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { inspectRustCache } from './rust-build-cache.mjs';

test('reports logical sizes but counts hardlinked objects only once across directories', async t => {
  const root = await mkdtemp(join(tmpdir(), 'myagents-rust-cache-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'debug/deps'), { recursive: true });
  await mkdir(join(root, 'debug/incremental'), { recursive: true });
  await writeFile(join(root, 'debug/deps/object.o'), Buffer.alloc(4096));
  await link(join(root, 'debug/deps/object.o'), join(root, 'debug/incremental/object.o'));
  const groups = await inspectRustCache(root);
  assert.equal(groups.reduce((sum, g) => sum + g.apparent, 0), 8192);
  assert.equal(groups.reduce((sum, g) => sum + g.unique, 0), 4096);
  assert.equal(groups.reduce((sum, g) => sum + g.files, 0), 2);
});

test('does not follow directory symlinks or cycles; a missing cache is empty', async t => {
  const root = await mkdtemp(join(tmpdir(), 'myagents-rust-cache-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'target'));
  await writeFile(join(root, 'private'), 'outside');
  await symlink(root, join(root, 'target/outside'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual(await inspectRustCache(join(root, 'target')), []);
  assert.deepEqual(await inspectRustCache(join(root, 'absent')), []);
});
