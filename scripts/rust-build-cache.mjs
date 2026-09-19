#!/usr/bin/env node
// Read-only accounting. Cargo remains the owner of artifact deletion and locks.
import { lstat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function inspectRustCache(root) {
  const seen = new Set();
  const groups = new Map();
  async function walk(path, parts) {
    let stat;
    try {
      stat = await lstat(path, { bigint: true });
    } catch (error) {
      // A concurrent build/clean can remove an entry during this snapshot.
      if (error.code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      let entries;
      try {
        entries = await readdir(path);
      } catch (error) {
        if (error.code === 'ENOENT') return;
        throw error;
      }
      for (const entry of entries.sort()) await walk(join(path, entry), [...parts, entry]);
      return;
    }
    if (!stat.isFile()) return;
    const name = parts.slice(0, Math.min(2, parts.length - 1)).join('/') || '(root files)';
    const group = groups.get(name) ?? { apparent: 0, unique: 0, files: 0 };
    group.apparent += Number(stat.size);
    group.files++;
    const inode = `${stat.dev}:${stat.ino}`;
    if (!seen.has(inode)) {
      group.unique += Number(stat.size);
      seen.add(inode);
    }
    groups.set(name, group);
  }
  await walk(root, []);
  return [...groups].map(([name, sizes]) => ({ name, ...sizes }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) {
    console.error('Usage: npm run cache:rust (read-only; no arguments)');
    process.exitCode = 1;
  } else {
    const root = fileURLToPath(new URL('../src-tauri/target', import.meta.url));
    const groups = await inspectRustCache(root);
    const gib = bytes => `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
    console.log(`Rust build artifacts: ${root}`);
    console.table(groups.sort((a, b) => b.unique - a.unique).map(group => ({
      directory: group.name, 'file sizes': gib(group.apparent), 'hardlink-deduplicated': gib(group.unique),
    })));
    console.log(`Total: ${gib(groups.reduce((n, g) => n + g.apparent, 0))} file sizes; ${gib(groups.reduce((n, g) => n + g.unique, 0))} after hardlink deduplication.`);
    console.log('Read-only snapshot; shared hardlinks count toward the first directory visited. Not an estimate of reclaimable space (filesystem clones/compression/snapshots can differ).');
    console.log('Main crate dev artifacts: npm run clean:rust:app -- --dry-run');
    console.log('All Rust artifacts (including built app bundles): npm run clean:rust -- --dry-run');
    console.log('Remove --dry-run to clean. Close apps launched from target before cleaning all artifacts.');
  }
}
