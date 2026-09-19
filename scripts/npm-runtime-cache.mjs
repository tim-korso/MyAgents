// Build-time npm resources: immutable verified cache -> mutable signing projection.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, posix, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { withResourcePrepareLock } from './document-processing-resource-cache.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));

/** Keep npm's resolved package layout, including nested esbuild, but only the
 * requested runtime's closure. App version/unrelated dependencies are not inputs. */
export function runtimeLock(projectRoot, name) {
  const project = readJson(join(projectRoot, 'package.json'));
  const version = project.dependencies?.[name] ?? project.devDependencies?.[name];
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error(`${name} must use an exact package version`);
  const source = readJson(join(projectRoot, 'package-lock.json'));
  if (source.lockfileVersion !== 3) throw new Error('npm runtime preparation requires package-lock v3');
  const root = { name: `myagents-${name}-runtime`, version: '1.0.0', dependencies: { [name]: version } };
  const packages = { '': root };
  function visit(path) {
    if (packages[path]) return;
    const entry = source.packages[path];
    if (!entry || entry.link) throw new Error(`Missing locked runtime dependency: ${path}`);
    const copy = { ...entry };
    delete copy.dev;
    delete copy.devOptional;
    packages[path] = copy;
    for (const dependency of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies, ...entry.peerDependencies })) {
      let base = path;
      let found;
      for (;;) {
        const candidate = posix.join(base, 'node_modules', dependency);
        if (source.packages[candidate]) { found = candidate; break; }
        if (!base) break;
        base = posix.dirname(base);
        if (base === '.') base = '';
      }
      if (found) visit(found);
      else if (!entry.optionalDependencies?.[dependency] && !entry.peerDependenciesMeta?.[dependency]?.optional) {
        throw new Error(`Missing locked ${dependency} required by ${path}`);
      }
    }
  }
  visit(`node_modules/${name}`);
  if (packages[`node_modules/${name}`].version !== version) throw new Error(`${name} package.json/lock version mismatch`);
  return { name: root.name, version: root.version, lockfileVersion: 3, requires: true, packages };
}

// Include executable permissions and relative symlinks (npm .bin), reject escapes
// and special files. Recompute the complete inventory, so extra files also miss.
function inventory(root, directory = root) {
  return readdirSync(directory).sort().flatMap(name => {
    const path = join(directory, name);
    const info = lstatSync(path);
    const key = relative(root, path).split('\\').join('/');
    if (info.isSymbolicLink()) {
      const target = readlinkSync(path);
      const destination = relative(root, resolve(dirname(path), target));
      if (isAbsolute(target) || destination === '..' || destination.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
        throw new Error(`Runtime symlink escapes bundle: ${key}`);
      }
      const actual = relative(realpathSync(root), realpathSync(path));
      if (actual === '..' || actual.startsWith('../') || actual.startsWith('..\\') || isAbsolute(actual)) {
        throw new Error(`Runtime symlink escapes bundle: ${key}`);
      }
      return [[key, 'link', target]];
    }
    if (info.isDirectory()) return [[key, 'directory'], ...inventory(root, path)];
    if (!info.isFile()) throw new Error(`Unsupported runtime file: ${key}`);
    return [[key, info.size, info.mode & 0o111, digest(readFileSync(path))]];
  });
}

function publish(source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = mkdtempSync(join(dirname(destination), '.npm-runtime-stage-'));
  const next = join(temporary, 'next');
  const previous = join(temporary, 'previous');
  try {
    cpSync(source, next, { recursive: true, verbatimSymlinks: true });
    if (existsSync(destination)) renameSync(destination, previous);
    try { renameSync(next, destination); }
    catch (error) {
      if (existsSync(previous)) renameSync(previous, destination);
      throw error;
    }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

export function installRuntime(root, os, cpu) {
  // npm.cmd requires a shell on Windows; every argument here is fixed/validated.
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
    'ci', '--no-audit', '--no-fund', '--ignore-scripts', '--force',
    `--os=${os}`, `--cpu=${cpu}`, ...(os === 'linux' ? ['--libc=glibc'] : []),
  ], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
}

export async function prepareNpmRuntime({ projectRoot, name, os, cpu, implementationFiles, validate, clean = () => {}, install = installRuntime, log = console.log }) {
  if (!['tsx', 'sharp'].includes(name) || !['darwin', 'linux', 'win32'].includes(os) || !['arm64', 'x64'].includes(cpu)) {
    throw new Error('Expected tsx/sharp, darwin/linux/win32 and arm64/x64');
  }
  const lock = runtimeLock(projectRoot, name);
  const fingerprint = digest(JSON.stringify({
    schema: 1, os, cpu, lock,
    implementation: [new URL(import.meta.url), ...implementationFiles].map(path => digest(readFileSync(path))),
  }));
  const cacheRoot = join(projectRoot, 'src-tauri/resources/npm-runtime-cache');
  const cache = join(cacheRoot, name, `${os}-${cpu}`, fingerprint);
  const destination = join(projectRoot, `src-tauri/resources/${name}-runtime`);
  const label = `[resource:${name} ${os}-${cpu}]`;
  return withResourcePrepareLock(cacheRoot, async () => {
    let miss = 'target/dependency/prepare fingerprint has no cache';
    try {
      const expected = readJson(join(cache, 'inventory.json'));
      if (JSON.stringify(expected) !== JSON.stringify(inventory(join(cache, 'payload')))) throw new Error('file inventory differs');
      validate(join(cache, 'payload'), os, cpu);
      miss = null;
    } catch (error) {
      if (existsSync(cache)) miss = `cache validation failed: ${error.message}`;
    }
    if (miss) {
      log(`${label} MISS: ${miss}; installing locked dependencies`);
      mkdirSync(dirname(cache), { recursive: true });
      const temporary = mkdtempSync(join(dirname(cache), '.prepare-'));
      const payload = join(temporary, 'payload');
      mkdirSync(payload);
      try {
        writeFileSync(join(payload, 'package.json'), JSON.stringify({ ...lock.packages[''], private: true }));
        writeFileSync(join(payload, 'package-lock.json'), JSON.stringify(lock));
        await install(payload, os, cpu);
        clean(payload);
        validate(payload, os, cpu);
        writeFileSync(join(temporary, 'inventory.json'), JSON.stringify(inventory(payload)));
        // Only replace a corrupt old cache after its replacement has validated.
        if (existsSync(cache)) rmSync(cache, { recursive: true, force: true });
        renameSync(temporary, cache);
      } finally { rmSync(temporary, { recursive: true, force: true }); }
    } else log(`${label} HIT: verified locked dependencies and file integrity`);
    publish(join(cache, 'payload'), destination);
    log(`${label} STAGED: copied an independent signing/build projection`);
    return { root: destination, cacheHit: miss === null };
  }, { onWait: () => log(`${label} WAIT: another npm runtime preparation is active`) });
}
