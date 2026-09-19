#!/usr/bin/env node
// Required context: specs/tech_docs/managed_cliproxy.md, CLIProxy update runbook.
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import AdmZip from 'adm-zip';
import { mergeReleases, selectBundledRelease, validateReleases } from './cliproxy-release-policy.mjs';
import { assertPublicationRevision, verifyManifestSignature } from './publish-cliproxy-component.mjs';
import { resolveSpawnInvocation, formatCommandFailure } from './package-managed-codex-spawn.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = JSON.parse(readFileSync(join(repo, 'src/shared/managed-cliproxy-source.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = /^[0-9a-f]{64}$/;
const platforms = ['darwin-arm64', 'darwin-x64', 'win32-x64'];

function run(command, args, options = {}) {
  const invocation = resolveSpawnInvocation(command, args);
  const result = spawnSync(invocation.command, invocation.args, { encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) throw new Error(formatCommandFailure(command, args, result));
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

export function checkArchive(bytes, pin) {
  if (bytes.length !== pin.size || hash(bytes) !== pin.sha256) throw new Error('Upstream artifact differs from the pinned source');
}
export function validateApproval(approval, platformRecords, sourcePin = source) {
  const source = sourcePin;
  const { controls } = approval;
  const compatibility = { ...approval.compatibility };
  if (!controls || !Number.isSafeInteger(controls.policyRevision) || controls.policyRevision <= 0
    || !['internal', 'disabled', 'enabled'].includes(controls.providerMode)
    || !Array.isArray(controls.revokedVersions) || !Array.isArray(controls.revokedArtifacts)
    || controls.revokedArtifacts.some(value => !digest.test(value))) throw new Error('Invalid controls');
  if (!compatibility || typeof compatibility.minAppVersion !== 'string'
    || !Number.isSafeInteger(compatibility.revision) || compatibility.revision <= 0
    || !Array.isArray(compatibility.credentialCompatibleVersions)) throw new Error('Invalid compatibility record');
  const seenPlatforms = new Set();
  for (const record of platformRecords) {
    if (!platforms.includes(record.platform) || record.version !== source.version || record.commit !== source.commit
      || seenPlatforms.has(record.platform) || record.artifact.sourceSha256 !== source.platforms[record.platform].sha256) throw new Error('Platform source record mismatch');
    seenPlatforms.add(record.platform);
  }
  if (controls.providerMode === 'enabled' && (platforms.some(platform => !platformRecords.some(r => r.platform === platform))
    || platformRecords.some(r => r.platformSigning === 'ad-hoc'))) throw new Error('Public enabled requires all production platform artifacts');
  const component = { version: source.version, tag: source.tag, commit: source.commit,
    compatibility, artifacts: Object.fromEntries(platformRecords.map(record => [record.platform, record.artifact])) };
  validateReleases([component]);
  return { schemaVersion: 1, controls, releases: [component] };
}

function assertArchitecture(path, platform) {
  if (platform.startsWith('darwin-')) {
    if (process.platform !== 'darwin') throw new Error('Prepare macOS artifacts on macOS');
    const actual = run('/usr/bin/lipo', ['-archs', path]).trim();
    if (actual !== (platform === 'darwin-arm64' ? 'arm64' : 'x86_64')) throw new Error('Native architecture mismatch');
  } else {
    const bytes = readFileSync(path);
    const pe = bytes.readUInt32LE(0x3c);
    if (bytes.subarray(0, 2).toString() !== 'MZ' || pe > bytes.length - 6
      || bytes.readUInt32LE(pe) !== 0x4550 || bytes.readUInt16LE(pe + 4) !== 0x8664) throw new Error('Expected a Windows x64 executable');
  }
}

function sourceFor(args) {
  return args['source-lock'] ? JSON.parse(readFileSync(resolve(args['source-lock']), 'utf8')) : source;
}

function packageArtifact(args) {
  const source = sourceFor(args);
  const platform = args.platform;
  const pin = source.platforms[platform];
  if (!pin || !args.source || !args.out) throw new Error('artifact requires --platform, --source <pinned archive>, --out');
  const input = resolve(args.source);
  const bytes = readFileSync(input);
  checkArchive(bytes, pin);
  const scratch = mkdtempSync(join(tmpdir(), 'myagents-cliproxy-package-'));
  const executable = platform === 'win32-x64' ? 'cli-proxy-api.exe' : 'cli-proxy-api';
  try {
    if (platform === 'win32-x64') {
      const zip = new AdmZip(bytes);
      for (const name of [executable, 'LICENSE']) {
        const entries = zip.getEntries().filter(entry => entry.entryName === name && !entry.isDirectory);
        if (entries.length !== 1 || entries[0].header.size > 256 * 1024 * 1024) throw new Error('Unexpected upstream ZIP layout');
        writeFileSync(join(scratch, name), entries[0].getData(), { mode: 0o600, flag: 'wx' });
      }
    } else {
      run('/usr/bin/tar', ['-xzf', input, '-C', scratch, executable, 'LICENSE']);
    }
    for (const name of [executable, 'LICENSE']) {
      const metadata = lstatSync(join(scratch, name));
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 256 * 1024 * 1024) throw new Error('Unexpected upstream file');
    }
    const binary = join(scratch, executable);
    assertArchitecture(binary, platform);
    let platformSigning = 'upstream-unmodified';
    if (platform.startsWith('darwin-')) {
      const identity = args.development ? '-' : process.env.APPLE_SIGNING_IDENTITY;
      if (!identity) throw new Error('APPLE_SIGNING_IDENTITY is required for production macOS artifacts');
      run('/usr/bin/codesign', ['--force', '--options', 'runtime', ...(args.development ? [] : ['--timestamp']), '--sign', identity, binary]);
      run('/usr/bin/codesign', ['--verify', '--strict', binary]);
      platformSigning = args.development ? 'ad-hoc' : 'developer-id';
      if (!args.development && !run('/usr/bin/codesign', ['-dv', '--verbose=4', binary]).includes(`Authority=${identity}`)) throw new Error('macOS signer mismatch');
    }
    const files = Object.fromEntries([executable, 'LICENSE'].map(name => [name, hash(readFileSync(join(scratch, name)))]));
    const zip = new AdmZip();
    for (const name of [executable, 'LICENSE']) zip.addLocalFile(join(scratch, name));
    const archive = zip.toBuffer();
    const sha256 = hash(archive);
    const out = resolve(args.out);
    mkdirSync(out, { recursive: true });
    const filename = `${source.version}-${platform}-${sha256}.zip`;
    const target = join(out, filename);
    if (!existsSync(target)) writeFileSync(target, archive, { flag: 'wx' });
    else if (hash(readFileSync(target)) !== sha256) throw new Error('Immutable artifact collision');
    const record = { platform, version: source.version, commit: source.commit, platformSigning,
      artifact: { url: `https://download.myagents.io/runtimes/cliproxy/${filename}`, size: archive.length, sha256,
        sourceSha256: pin.sha256, files, executable } };
    writeFileSync(join(out, `${platform}.record.json`), `${JSON.stringify(record, null, 2)}\n`);
    console.log(`Prepared ${platform}: ${filename}`);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

function signManifest(path) {
  const privateKey = process.env.TAURI_SIGNING_PRIVATE_KEY;
  if (!privateKey) throw new Error('TAURI_SIGNING_PRIVATE_KEY is required; unsigned manifests cannot be staged');
  const keyFile = join(tmpdir(), `myagents-cliproxy-signing-${randomUUID()}`);
  writeFileSync(keyFile, privateKey, { flag: 'wx', mode: 0o600 });
  try {
    const env = { ...process.env };
    delete env.TAURI_SIGNING_PRIVATE_KEY; delete env.TAURI_PRIVATE_KEY;
    if (env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD) env.TAURI_PRIVATE_KEY_PASSWORD = env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
    run('npx', ['tauri', 'signer', 'sign', '-f', keyFile, path], { cwd: repo, env });
  } finally { rmSync(keyFile, { force: true }); }
}

function packageManifest(args) {
  if (!args.approval || !args.records || !args.out) throw new Error('manifest requires --approval, --records, --out');
  const records = readdirSync(args.records).filter(name => name.endsWith('.record.json'))
    .map(name => JSON.parse(readFileSync(join(args.records, name), 'utf8')));
  const manifest = validateApproval(JSON.parse(readFileSync(args.approval, 'utf8')), records, sourceFor(args));
  if (args.base) {
    const bytes = readFileSync(join(args.base, 'manifest-v1.json'));
    verifyManifestSignature(bytes, readFileSync(join(args.base, 'manifest-v1.json.sig'), 'utf8'));
    const previous = JSON.parse(bytes);
    manifest.releases = mergeReleases(previous.releases, manifest.releases);
    assertPublicationRevision(previous, manifest);
  }
  for (const record of records) {
    const artifact = join(args.records, basename(new URL(record.artifact.url).pathname));
    if (statSync(artifact).size !== record.artifact.size || hash(readFileSync(artifact)) !== record.artifact.sha256) throw new Error('Prepared artifact no longer matches its record');
  }
  const out = resolve(args.out); mkdirSync(out, { recursive: true });
  const path = join(out, 'manifest-v1.json');
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  rmSync(`${path}.sig`, { force: true });
  signManifest(path);
  for (const record of records) {
    const name = basename(new URL(record.artifact.url).pathname);
    const input = resolve(args.records, name); const target = resolve(out, name);
    if (input !== target) copyFileSync(input, target);
  }
  console.log(`Signed ${manifest.controls.providerMode} manifest for ${records.map(r => r.platform).join(', ')}`);
}

function stageBundle(args) {
  if (!args.from || !args.platform) throw new Error('stage requires --from <signed distribution directory> and --platform');
  const from = resolve(args.from);
  const manifestBytes = readFileSync(join(from, 'manifest-v1.json'));
  if (manifestBytes.length > 256 * 1024) throw new Error('Manifest too large');
  const manifest = JSON.parse(manifestBytes);
  const component = selectBundledRelease(manifest.releases, pkg.version, source);
  const artifact = component.artifacts?.[args.platform];
  if (!artifact) throw new Error('Bundled platform mismatch');
  const filename = basename(new URL(artifact.url).pathname);
  const archive = readFileSync(join(from, filename));
  if (archive.length !== artifact.size || hash(archive) !== artifact.sha256) throw new Error('Bundled artifact integrity mismatch');
  const signature = readFileSync(join(from, 'manifest-v1.json.sig'));
  if (!signature.length || signature.length > 16 * 1024) throw new Error('Bundled signature missing');
  const out = resolve(args.out ?? join(repo, 'src-tauri/resources/cliproxy'));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'manifest-v1.json'), manifestBytes);
  writeFileSync(join(out, 'manifest-v1.json.sig'), signature);
  writeFileSync(join(out, 'artifact.zip'), archive);
  // Cryptographic verification uses the same Rust verifier at build and
  // execution; this script never introduces another signing trust root.
  console.log(`Staged ${args.platform} CLIProxy bundle`);
}

function main() {
  const [command, ...argv] = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--development') { args.development = true; continue; }
    if (!/^--(platform|source|source-lock|out|approval|records|from|base)$/.test(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Invalid packaging argument');
    args[argv[i].slice(2)] = argv[++i];
  }
  if (command === 'artifact') packageArtifact(args);
  else if (command === 'manifest') packageManifest(args);
  else if (command === 'stage') stageBundle(args);
  else throw new Error('Usage: package-cliproxy-component.mjs artifact|manifest|stage [options]');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
