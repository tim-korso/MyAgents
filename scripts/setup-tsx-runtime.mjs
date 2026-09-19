// Plugin Bridge needs a complete target-specific tsx/esbuild install. Keep the
// project's exact tsx pin: 4.21.1+ broke require(JSON) under the ESM import hook.
// Watch-only fsevents is unused and must not introduce an unsigned native addon.
import { rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareNpmRuntime } from './npm-runtime-cache.mjs';
import { validateTsxRuntime } from './npm-runtime-validation.mjs';

export function prepareTsxRuntime(os, cpu, options = {}) {
  return prepareNpmRuntime({
    projectRoot: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
    name: 'tsx', os, cpu,
    implementationFiles: [new URL(import.meta.url), new URL('./npm-runtime-validation.mjs', import.meta.url)],
    clean: root => rmSync(join(root, 'node_modules/fsevents'), { recursive: true, force: true }),
    validate: validateTsxRuntime,
    ...options,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw new Error('Usage: node scripts/setup-tsx-runtime.mjs <darwin|linux|win32> <arm64|x64>');
  await prepareTsxRuntime(...process.argv.slice(2));
}
