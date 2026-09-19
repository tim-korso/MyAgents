// All release platforms use the same locked sharp/native dependency closure.
// Cache remains unsigned; platform packaging signs only the staged copy.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareNpmRuntime } from './npm-runtime-cache.mjs';
import { validateSharpRuntime } from './npm-runtime-validation.mjs';

export function prepareSharpRuntime(os, cpu, options = {}) {
  return prepareNpmRuntime({
    projectRoot: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
    name: 'sharp', os, cpu,
    implementationFiles: [new URL(import.meta.url), new URL('./npm-runtime-validation.mjs', import.meta.url)],
    validate: validateSharpRuntime,
    ...options,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw new Error('Usage: node scripts/prepare-sharp-runtime.mjs <darwin|linux|win32> <arm64|x64>');
  await prepareSharpRuntime(...process.argv.slice(2));
}
