import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

const repo = resolve(import.meta.dirname, '..');
const source = readFileSync(join(repo, 'build_linux.sh'), 'utf8');

function put(path, content, executable = false) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  if (executable) chmodSync(path, 0o755);
}

function fixture(t, { os = 'ubuntu', version = '24.04', kernel = 'Linux', arch = 'x86_64', missing = '' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'myagents-linux-build-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  const log = join(root, 'calls');
  const osRelease = join(root, 'os-release');
  put(osRelease, `ID=${os}\nVERSION_ID=${version}\nPRETTY_NAME=fixture\n`);
  // Substitute only the kernel-owned OS release file in the disposable script.
  // All branch/command flow is the real entry point; production has no test bypass.
  put(join(root, 'build_linux.sh'), source.replaceAll('/etc/os-release', osRelease), true);
  cpSync(join(repo, 'build_dev_linux.sh'), join(root, 'build_dev_linux.sh'));
  cpSync(join(repo, 'setup.sh'), join(root, 'setup.sh'));
  put(join(root, '.env'), 'echo env-loaded >> "$TEST_CALLS"\n');
  put(join(bin, 'uname'), `#!/bin/sh\nif [ "$1" = -s ]; then echo '${kernel}'; else echo '${arch}'; fi\n`, true);
  put(join(bin, 'dpkg-query'), `#!/bin/sh\nif [ "$3" = '${missing}' ]; then exit 1; fi\nprintf 'install ok installed'\n`, true);
  for (const command of ['rustc', 'cargo', 'rustup', 'dpkg-deb', 'sha256sum', 'apt-get', 'sudo']) {
    put(join(bin, command), `#!/bin/sh\necho '${command}' "$@" >> "$TEST_CALLS"\n`, true);
  }
  put(join(bin, 'node'), `#!/bin/sh
echo node "$@" >> "$TEST_CALLS"
if [ "$1" = -p ]; then echo 0.4.17; fi
`, true);
  put(join(bin, 'npm'), `#!/bin/sh
echo npm "$@" >> "$TEST_CALLS"
case "$*" in
  *--debug*)
    mkdir -p src-tauri/target/x86_64-unknown-linux-gnu/debug
    printf '#!/bin/sh\\necho app-started >> "$TEST_CALLS"\\n' > src-tauri/target/x86_64-unknown-linux-gnu/debug/myagents
    chmod +x src-tauri/target/x86_64-unknown-linux-gnu/debug/myagents ;;
  *--bundles*)
    mkdir -p src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb
    touch src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb/MyAgents_0.4.17_amd64.deb ;;
esac
`, true);
  for (const script of ['ensure_rust_toolchain.sh', 'download_nodejs.sh']) {
    put(join(root, 'scripts', script), `#!/bin/sh\necho '${script}' "$@" >> "$TEST_CALLS"\n`, true);
  }
  put(join(root, 'src-tauri/resources/nodejs/bin/node'), '#!/bin/sh\nexit 0\n', true);
  put(join(root, 'node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude'), '#!/bin/sh\nexit 0\n', true);
  for (const capability of ['document-processing', 'speech-inference']) {
    put(join(root, 'src-tauri/resources', capability, 'v1/manifest.json'), '{}');
  }
  return {
    root,
    calls: () => { try { return readFileSync(log, 'utf8'); } catch { return ''; } },
    run: (args = [], dev = false) => spawnSync('bash', [join(root, dev === 'setup' ? 'setup.sh' : dev ? 'build_dev_linux.sh' : 'build_linux.sh'), ...args], {
      cwd: tmpdir(), encoding: 'utf8', timeout: 15_000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_CALLS: log, DISPLAY: '', WAYLAND_DISPLAY: '' },
    }),
  };
}

for (const [label, options, args] of [
  ['macOS host', { kernel: 'Darwin' }, []],
  ['ARM host', { arch: 'aarch64' }, []],
  ['Ubuntu 22.04', { version: '22.04' }, []],
  ['other distro', { os: 'debian' }, []],
  ['cross target', {}, ['aarch64-unknown-linux-gnu']],
  ['extra arguments', {}, ['--debug', '--prepare']],
]) {
  test(`Linux build rejects ${label} before env/resources/tools`, t => {
    const f = fixture(t, options);
    assert.notEqual(f.run(args).status, 0);
    assert.equal(f.calls(), '');
  });
}

test('missing audio dependency stops preflight before native preparation', t => {
  const f = fixture(t, { missing: 'libpipewire-0.3-dev' });
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /libpipewire-0.3-dev/);
  assert.equal(f.calls(), '');
});

test('system-dependency install and check do not start app preparation', t => {
  const f = fixture(t);
  assert.equal(f.run(['--check-system-deps']).status, 0);
  assert.equal(f.calls(), '');
  assert.equal(f.run(['--install-deps']).status, 0);
  assert.match(f.calls(), /libpipewire-0.3-dev libasound2-dev/);
  assert.doesNotMatch(f.calls(), /env-loaded|native-inference|npm/);
});

test('setup resource mode stages all entry points without building a desktop binary', t => {
  const f = fixture(t);
  const result = f.run(['--prepare']);
  assert.equal(result.status, 0, result.stderr);
  for (const bundle of ['server', 'bridge', 'cli']) assert.match(f.calls(), new RegExp(`npm run build:${bundle}`));
  assert.doesNotMatch(f.calls(), /tauri:build|npm run typecheck/);
});

test('Linux setup installs system dependencies then prepares complete development resources', t => {
  const f = fixture(t);
  const result = f.run([], 'setup');
  assert.equal(result.status, 0, result.stderr);
  assert.match(f.calls(), /npm install/);
  assert.match(f.calls(), /cargo fetch --manifest-path src-tauri\/Cargo.toml --locked/);
  assert.match(f.calls(), /npm run build:tsx-runtime -- linux x64/);
  assert.match(f.calls(), /npm run build:cli/);
  assert.ok(f.calls().indexOf('apt-get') < f.calls().indexOf('ensure_rust_toolchain.sh'));
  assert.match(result.stdout, /build_dev_linux.sh --build-only/);
  assert.doesNotMatch(f.calls(), /cargo check|tauri:build/);
});

test('dev wrapper delegates resources and debug/no-bundle build without launching in build-only mode', t => {
  const f = fixture(t);
  const result = f.run(['--build-only'], true);
  assert.equal(result.status, 0, result.stderr);
  assert.match(f.calls(), /tauri:build -- --target x86_64-unknown-linux-gnu --debug --no-bundle/);
  assert.doesNotMatch(f.calls(), /--bundles|app-started/);
});

test('release uses the same resources and produces only the current amd64 deb', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(f.calls(), /build:tsx-runtime -- linux x64/);
  assert.match(f.calls(), /tauri:build -- --target x86_64-unknown-linux-gnu --bundles deb/);
  assert.match(result.stdout, /MyAgents_0.4.17_amd64.deb/);
  assert.doesNotMatch(f.calls(), /appimage|codesign/);
});

test('Linux package disables updater signing and adds the native runtime dependencies', () => {
  const config = JSON.parse(readFileSync(join(repo, 'src-tauri/tauri.linux.conf.json'), 'utf8'));
  assert.equal(config.bundle.createUpdaterArtifacts, false);
  assert.deepEqual(config.bundle.targets, ['deb']);
  for (const name of ['libasound2t64', 'libpipewire-0.3-0t64', 'libssl3t64', 'git']) {
    assert.ok(config.bundle.linux.deb.depends.includes(name));
  }
});

test('installed-resource verifier rejects corrupt manifests and wrong ELF targets', () => {
  const result = spawnSync('python3', ['-B', join(repo, 'scripts/linux-package-smoke.test.py')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
