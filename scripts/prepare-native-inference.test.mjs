import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ensureLockedGitCheckout } from './prepare-document-processing.mjs';
import {
  orchestrateNativeInferencePreparation,
  parseNativeInferenceArgs,
} from './prepare-native-inference.mjs';
import {
  MINIMUM_SPEECH_CMAKE_VERSION,
  speechBuildPrerequisiteFailures,
  speechNativeTestPlan,
  runSpeechNativeTests,
} from './prepare-speech-inference.mjs';

test('Linux contract executable resolves Sherpa outside the relocatable adapter build directory', {
  skip: process.platform !== 'linux',
}, t => {
  const root = mkdtempSync(join(tmpdir(), 'speech link regression '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dependency = join(root, 'sherpa source');
  const source = join(root, 'adapter source');
  const sherpaBuild = join(root, 'sherpa build');
  const adapterBuild = join(root, 'adapter build');
  mkdirSync(dependency);
  mkdirSync(source);
  // Use the production target graph with tiny offline sources. The regression
  // is ELF dependency resolution, independent of Sherpa's inference algorithms.
  writeFileSync(join(dependency, 'CMakeLists.txt'), `
cmake_minimum_required(VERSION 3.28)
project(sherpa_link_fixture LANGUAGES CXX)
add_library(sherpa-onnx-c-api SHARED sherpa.cc)
`);
  writeFileSync(join(dependency, 'sherpa.cc'), 'extern "C" int sherpa_value() { return 42; }\n');
  copyFileSync(new URL('../src-tauri/media-worker/native/CMakeLists.txt', import.meta.url), join(source, 'CMakeLists.txt'));
  writeFileSync(join(source, 'myagents_speech_adapter.cc'), `
extern "C" int sherpa_value();
extern "C" __attribute__((visibility("default"))) int adapter_value() { return sherpa_value(); }
`);
  writeFileSync(join(source, 'adapter_contract_test.cc'), 'extern "C" int adapter_value(); int main() { return adapter_value() == 42 ? 0 : 1; }\n');
  for (const file of ['bounded_vad_test.cc', 'raw_evidence_test.cc']) {
    writeFileSync(join(source, file), 'int main() { return 0; }\n');
  }
  const env = { ...process.env };
  delete env.LD_LIBRARY_PATH;
  delete env.LIBRARY_PATH;
  const run = (command, args) => execFileSync(command, args, { env, encoding: 'utf8', stdio: 'pipe' });
  run('cmake', ['-S', dependency, '-B', sherpaBuild]);
  run('cmake', ['--build', sherpaBuild]);
  run('cmake', ['-S', source, '-B', adapterBuild, '-DBUILD_TESTING=ON',
    `-DMYAGENTS_SHERPA_LIBRARY=${join(sherpaBuild, 'libsherpa-onnx-c-api.so')}`,
    `-DMYAGENTS_SHERPA_INCLUDE_DIR=${dependency}`, `-DMYAGENTS_HCLUST_INCLUDE_DIR=${dependency}`]);
  run('cmake', ['--build', adapterBuild]);
  // Match production's execution environment, without leaking it into linking.
  execFileSync('ctest', ['--test-dir', adapterBuild, '--output-on-failure'], {
    env: { ...env, LD_LIBRARY_PATH: `${adapterBuild}:${sherpaBuild}` }, stdio: 'pipe',
  });
  const dynamic = run('readelf', ['-d', join(adapterBuild, 'libmyagents-speech-adapter.so')]);
  assert.match(dynamic, /\$ORIGIN/);
  assert.ok(!dynamic.includes(sherpaBuild), 'packaged adapter must not capture the build directory');
});

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function commit(cwd, message) {
  git(cwd, [
    '-c',
    'user.name=MyAgents Test',
    '-c',
    'user.email=myagents-test@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    message,
  ]);
}

test('native inference preparation owns one lock and passes the document runtime directly to speech', async () => {
  const events = [];
  const runtime = Object.freeze({
    target: 'x86_64-apple-darwin',
    path: '/prepared/document/libonnxruntime.dylib',
  });
  const options = parseNativeInferenceArgs(
    ['x86_64-apple-darwin', '--offline'],
    {},
  );

  const result = await orchestrateNativeInferencePreparation({
    options,
    resourceCacheRoot: '/cache',
    withLock: async (root, action) => {
      events.push(['lock', root]);
      return action();
    },
    prepareDocumentProcessing: async (receivedOptions) => {
      events.push(['document', receivedOptions]);
      return Object.freeze({
        target: receivedOptions.target,
        needsBuild: false,
        runtime,
      });
    },
    prepareSpeechInference: async (receivedOptions, documentResult) => {
      events.push(['speech', receivedOptions, documentResult.runtime]);
      return Object.freeze({
        target: receivedOptions.target,
        needsBuild: false,
      });
    },
  });

  assert.deepEqual(result, {
    target: 'x86_64-apple-darwin',
    needsBuild: false,
  });
  assert.deepEqual(events, [
    ['lock', '/cache'],
    ['document', options],
    ['speech', options, runtime],
  ]);
});

test('native inference arguments define one target and reject conflicting preflight modes', () => {
  assert.deepEqual(
    parseNativeInferenceArgs(['aarch64-apple-darwin'], {
      MYAGENTS_NATIVE_RESOURCES_OFFLINE: '1',
    }),
    {
      target: 'aarch64-apple-darwin',
      force: false,
      checkPrerequisites: false,
      offlineRequested: false,
      documentOffline: false,
      speechOffline: true,
    },
  );
  assert.throws(
    () =>
      parseNativeInferenceArgs([
        'aarch64-apple-darwin',
        '--check-prerequisites',
        '--offline',
      ]),
    /cannot be combined/,
  );
  assert.throws(() => parseNativeInferenceArgs(['a', 'b']), /Usage:/);
});

test('speech preflight enforces the native adapter CMake floor', () => {
  const completeTools = {
    cmakeVersion: 'cmake version 3.28.0',
    cargoVersion: 'cargo 1.89.0',
    compiler: '/usr/bin/c++',
  };
  assert.equal(MINIMUM_SPEECH_CMAKE_VERSION, '3.28.0');
  assert.deepEqual(speechBuildPrerequisiteFailures(completeTools, 'linux'), []);

  const old = speechBuildPrerequisiteFailures(
    { ...completeTools, cmakeVersion: 'cmake version 3.27.9' },
    'linux',
  );
  assert.match(old[0], /CMake >= 3\.28\.0 \(found 3\.27\.9/);

  const unknown = speechBuildPrerequisiteFailures(
    { ...completeTools, cmakeVersion: 'unexpected output' },
    'linux',
  );
  assert.match(unknown[0], /could not parse/);
});

test('managed ORT source cache recovers interrupted Git states without refetching a locked HEAD', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'myagents-ort-source-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const upstreamWork = join(root, 'upstream-work');
  const upstreamBare = join(root, 'upstream.git');
  mkdirSync(upstreamWork);
  git(upstreamWork, ['init', '-q']);
  writeFileSync(join(upstreamWork, 'source.txt'), 'locked\n');
  git(upstreamWork, ['add', 'source.txt']);
  commit(upstreamWork, 'locked source');
  const lockedCommit = git(upstreamWork, ['rev-parse', 'HEAD']);
  git(root, ['clone', '--quiet', '--bare', upstreamWork, upstreamBare]);

  const cache = join(root, 'cache');
  mkdirSync(cache);
  git(cache, ['init', '-q']);
  ensureLockedGitCheckout(cache, upstreamBare, lockedCommit);
  assert.equal(git(cache, ['rev-parse', '--verify', 'HEAD']), lockedCommit);
  assert.equal(git(cache, ['remote', 'get-url', 'origin']), upstreamBare);

  const unavailableUpstream = join(root, 'upstream-offline.git');
  renameSync(upstreamBare, unavailableUpstream);
  try {
    assert.doesNotThrow(() =>
      ensureLockedGitCheckout(cache, upstreamBare, lockedCommit),
    );
  } finally {
    renameSync(unavailableUpstream, upstreamBare);
  }

  writeFileSync(join(cache, 'source.txt'), 'interrupted wrong checkout\n');
  git(cache, ['add', 'source.txt']);
  commit(cache, 'wrong source');
  git(cache, ['remote', 'set-url', 'origin', join(root, 'wrong-origin.git')]);
  ensureLockedGitCheckout(cache, upstreamBare, lockedCommit);
  assert.equal(git(cache, ['rev-parse', '--verify', 'HEAD']), lockedCommit);
  assert.equal(git(cache, ['remote', 'get-url', 'origin']), upstreamBare);
});

// A target that can be compiled need not be executable on the build host.
for (const [host, target, runs] of [
  ['aarch64-apple-darwin', 'aarch64-apple-darwin', true],
  ['aarch64-apple-darwin', 'x86_64-apple-darwin', false],
  ['x86_64-apple-darwin', 'aarch64-apple-darwin', false],
  ['x86_64-pc-windows-msvc', 'x86_64-pc-windows-msvc', true],
  ['x86_64-unknown-linux-gnu', 'x86_64-unknown-linux-gnu', true],
]) {
  test(`speech native test execution ${host} -> ${target}`, () => {
    const plan = speechNativeTestPlan(target, host);
    assert.equal(plan.buildTesting, runs ? 'ON' : 'OFF');
    const calls = [];
    const result = runSpeechNativeTests({ target, hostTarget: host, buildDir: 'build with spaces', env: {} },
      (...args) => calls.push(args));
    assert.equal(result, runs ? 'passed' : 'not-run-cross-target');
    assert.equal(calls.length, runs ? 1 : 0);
    if (runs) {
      assert.equal(calls[0][0], 'ctest');
      assert.equal(calls[0][1][1], 'build with spaces');
      assert.throws(() => runSpeechNativeTests({ target, hostTarget: host, buildDir: 'b', env: {} },
        () => { throw new Error('test assertion failed'); }), /test assertion failed/);
    }
  });
}
