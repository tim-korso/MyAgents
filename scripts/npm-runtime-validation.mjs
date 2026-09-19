import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function runtimeFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? runtimeFiles(path) : entry.isFile() ? [path] : [];
  });
}

export const NATIVE_LIBRARY = /\.(?:node|dylib|dll|so(?:\.\d+)*)$/i;

export function validateRuntimeBinary(path, os, cpu) {
  const bytes = readFileSync(path);
  let valid = false;
  if (bytes.length >= 64) {
    if (os === 'darwin') valid = bytes.readUInt32LE(0) === 0xfeedfacf
      && bytes.readUInt32LE(4) === (cpu === 'arm64' ? 0x0100000c : 0x01000007);
    if (os === 'linux') valid = bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
      && bytes[4] === 2 && bytes[5] === 1 && bytes.readUInt16LE(18) === (cpu === 'arm64' ? 183 : 62);
    if (os === 'win32' && bytes.toString('ascii', 0, 2) === 'MZ') {
      const pe = bytes.readUInt32LE(0x3c);
      valid = pe + 6 <= bytes.length && bytes.readUInt32LE(pe) === 0x4550
        && bytes.readUInt16LE(pe + 4) === (cpu === 'arm64' ? 0xaa64 : 0x8664);
    }
  }
  if (!valid) throw new Error(`Wrong or invalid ${os}-${cpu} native binary: ${path}`);
}

export function validateTsxRuntime(root, os, cpu) {
  // esbuild may be hoisted or nested in the lock; its platform binary follows
  // the same npm resolution. Locate the sole selected @esbuild package by path.
  const binaries = runtimeFiles(join(root, 'node_modules')).filter(path =>
    path.split('\\').join('/').endsWith(os === 'win32'
      ? `/@esbuild/${os}-${cpu}/esbuild.exe` : `/@esbuild/${os}-${cpu}/bin/esbuild`));
  if (binaries.length !== 1) throw new Error(`Expected one ${os}-${cpu} esbuild binary`);
  validateRuntimeBinary(binaries[0], os, cpu);
  const forbidden = runtimeFiles(join(root, 'node_modules')).filter(path => NATIVE_LIBRARY.test(path));
  if (forbidden.length) throw new Error(`Unexpected native libraries in tsx: ${forbidden.map(path => relative(root, path)).join(', ')}`);
  if (!existsSync(join(root, 'node_modules/tsx/dist/esm/index.mjs'))) throw new Error('Missing tsx ESM loader');
  if (os === process.platform && cpu === process.arch) {
    execFileSync(process.execPath, ['--import', pathToFileURL(join(root, 'node_modules/tsx/dist/esm/index.mjs')).href, '-e',
      'require("node:assert/strict").equal(require(process.argv[1]).name, "myagents-tsx-runtime")', join(root, 'package.json')], { cwd: root, stdio: 'pipe' });
    execFileSync(binaries[0], ['--version'], { stdio: 'pipe' });
  }
}

export function validateSharpRuntime(root, os, cpu) {
  const native = join(root, `node_modules/@img/sharp-${os}-${cpu}/lib/sharp-${os}-${cpu}.node`);
  if (!existsSync(native)) throw new Error(`Missing sharp-${os}-${cpu}.node`);
  const libraries = runtimeFiles(join(root, 'node_modules')).filter(path => NATIVE_LIBRARY.test(path));
  for (const path of libraries) validateRuntimeBinary(path, os, cpu);
  if (!libraries.some(path => /(?:libvips|libvips-cpp).*(?:\.dylib|\.so|\.dll)/.test(path))) throw new Error('Missing sharp libvips library');
  if (os === process.platform && cpu === process.arch) {
    execFileSync(process.execPath, ['-e',
      'const sharp=require(process.argv[1]); sharp({create:{width:1,height:1,channels:3,background:"red"}}).png().toBuffer().catch(e=>{console.error(e);process.exitCode=1})',
      join(root, 'node_modules/sharp')], { cwd: root, stdio: 'pipe' });
  }
}
