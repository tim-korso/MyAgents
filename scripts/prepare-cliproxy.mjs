// Required context: specs/tech_docs/managed_cliproxy.md.
// Setup, local builds and CI consume the same signed repository snapshot.
// Publication/signing is a separate operation; these bytes are never executed.
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadBuildResource } from './build-resource-download.mjs';
import { selectBundledRelease } from './cliproxy-release-policy.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function bundledArtifact(manifest, source, pkg, platform) {
  const component = selectBundledRelease(manifest.releases, pkg.version, source);
  const artifact = component?.artifacts?.[platform];
  if (!source.platforms[platform] || !artifact
    || component.version !== source.version || component.commit !== source.commit
    || component.tag !== source.tag || artifact.sourceSha256 !== source.platforms[platform].sha256) {
    throw new Error('CLIProxy snapshot must match the source and minimum App policy; update the signed snapshot');
  }
  if (!/^[0-9a-f]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.size)
    || artifact.size <= 0 || artifact.size > 128 * 1024 * 1024
    || artifact.url !== `https://download.myagents.io/runtimes/cliproxy/${source.version}-${platform}-${artifact.sha256}.zip`) {
    throw new Error('Invalid immutable CLIProxy artifact');
  }
  return artifact;
}

export async function fetchArtifact(artifact, fetchImpl = fetch) {
  const bytes = await downloadBuildResource(artifact.url, { maxBytes: artifact.size, fetchImpl });
  if (bytes.length !== artifact.size || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) {
    throw new Error('CLIProxy artifact integrity mismatch');
  }
  return bytes;
}

function validArtifact(bytes, artifact) {
  return bytes.length === artifact.size
    && createHash('sha256').update(bytes).digest('hex') === artifact.sha256;
}

export async function prepareCliproxy({
  platform = `${process.platform}-${process.arch}`,
  repoRoot = repo,
  distributionDir = process.env.MYAGENTS_CLIPROXY_DISTRIBUTION_DIR,
  fetchImpl = fetch,
} = {}) {
  // CLIProxy has no Linux distribution; the Rust target gate agrees.
  if (['linux-x64', 'linux-arm64'].includes(platform)) return;
  const snapshot = distributionDir ? resolve(distributionDir) : join(repoRoot, '.github/cliproxy');
  const manifest = readFileSync(join(snapshot, 'manifest-v1.json'));
  const signature = readFileSync(join(snapshot, 'manifest-v1.json.sig'));
  if (manifest.length > 256 * 1024 || !signature.length || signature.length > 16 * 1024) {
    throw new Error('Invalid CLIProxy manifest/signature size');
  }
  const artifact = bundledArtifact(JSON.parse(manifest),
    JSON.parse(readFileSync(join(repoRoot, 'src/shared/managed-cliproxy-source.json'))),
    JSON.parse(readFileSync(join(repoRoot, 'package.json'))), platform);
  let bytes;
  if (distributionDir) {
    // An explicit local distribution is authoritative and offline. Never mask
    // its missing/corrupt inputs by downloading a different distribution.
    bytes = readFileSync(join(snapshot, basename(new URL(artifact.url).pathname)));
    if (!validArtifact(bytes, artifact)) throw new Error('CLIProxy distribution artifact integrity mismatch');
  } else {
    const cache = join(repoRoot, 'src-tauri/resources/cliproxy-cache/artifacts', `${artifact.sha256}.zip`);
    bytes = existsSync(cache) ? readFileSync(cache) : null;
    if (!bytes || !validArtifact(bytes, artifact)) {
      console.log(`[resource:cliproxy ${platform}] MISS: downloading pinned CLIProxy ${artifact.sha256.slice(0, 12)}…`);
      bytes = await fetchArtifact(artifact, fetchImpl);
      mkdirSync(dirname(cache), { recursive: true });
      const temporary = `${cache}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, bytes, { flag: 'wx' });
        renameSync(temporary, cache);
      } finally { rmSync(temporary, { force: true }); }
    } else {
      console.log(`[resource:cliproxy ${platform}] HIT: verified artifact hash`);
    }
  }
  const out = join(repoRoot, 'src-tauri/resources/cliproxy');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'manifest-v1.json'), manifest);
  writeFileSync(join(out, 'manifest-v1.json.sig'), signature);
  writeFileSync(join(out, 'artifact.zip'), bytes);
  // build_cliproxy.rs verifies the signature with the existing trust root
  // before compilation. Preparation needs neither private keys nor minisign.
  console.log(`Prepared signed ${platform} CLIProxy build inputs`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3) throw new Error('Usage: prepare-cliproxy.mjs [platform]');
  await prepareCliproxy({ platform: process.argv[2] });
}
