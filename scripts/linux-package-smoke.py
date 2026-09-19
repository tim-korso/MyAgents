#!/usr/bin/env python3
"""Check real Linux build/installed resources, without using system Node or user data."""

import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile
import time
import urllib.request


def run(args, *, env=None, cwd=None, timeout=60):
    return subprocess.run(args, env=env, cwd=cwd, timeout=timeout, check=True,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True).stdout


def checked_file(root, entry):
    path = root / entry['path']
    if not path.resolve().is_relative_to(root.resolve()) or path.is_symlink() or not path.is_file():
        raise ValueError(f'Invalid manifest file: {path}')
    if path.stat().st_size != entry['size']:
        raise ValueError(f'Size mismatch: {path}')
    with path.open('rb') as stream:
        actual = hashlib.file_digest(stream, 'sha256').hexdigest()
    if actual != entry['sha256']:
        raise ValueError(f'Hash mismatch: {path}')
    return path


def check_manifest(root):
    manifest = json.loads((root / 'manifest.json').read_text())
    if (manifest.get('platform'), manifest.get('architecture')) != ('linux', 'x64'):
        raise ValueError(f'Wrong native target: {root}')
    entries = list(manifest['files'].values()) + manifest['legalFiles']
    if 'worker' in manifest:
        entries.append(manifest['worker'])
    for entry in entries:
        checked_file(root, entry)
    return manifest


def check_elf(path):
    with path.open('rb') as stream:
        header = stream.read(20)
    if header[:4] != b'\x7fELF':
        return False
    if len(header) < 20 or header[4:6] != b'\x02\x01' or int.from_bytes(header[18:20], 'little') != 62:
        raise ValueError(f'Not an x86-64 Linux ELF: {path}')
    return True


def check_executable_dependencies(path, env):
    result = subprocess.run(['ldd', str(path)], env=env, capture_output=True, text=True)
    output = result.stdout + result.stderr
    if 'not found' in output or (result.returncode and 'not a dynamic executable' not in output
                                 and 'statically linked' not in output):
        raise ValueError(f'Unresolved runtime libraries: {path}\n{output}')


def load_native_libraries(document_root, document, speech_root, speech):
    # Published filenames differ from SONAMEs. Match native_bundle.rs: load exact
    # manifest paths globally before consumers; bare ldd cannot model that order.
    ort = ctypes.CDLL(str(document_root / document['files']['onnxRuntime']['path']),
                      mode=ctypes.RTLD_GLOBAL)
    ort.OrtGetApiBase.restype = ctypes.c_void_p
    if not ort.OrtGetApiBase():
        raise ValueError('ONNX Runtime API is unavailable')
    pdfium = ctypes.CDLL(str(document_root / document['files']['pdfium']['path']))
    pdfium.FPDF_InitLibrary()
    pdfium.FPDF_DestroyLibrary()
    sherpa = ctypes.CDLL(str(speech_root / speech['files']['sherpaOnnx']['path']),
                         mode=ctypes.RTLD_GLOBAL)
    adapter = ctypes.CDLL(str(speech_root / speech['files']['adapter']['path']))
    return ort, pdfium, sherpa, adapter


def check_startup(app, env, scratch):
    # CI invokes this under dbus-run-session + xvfb-run as an unprivileged user.
    # A live process alone is insufficient: wait for its own Sidecar ready endpoint.
    with (scratch / 'startup.log').open('w+') as log:
        child = subprocess.Popen([str(app)], cwd=scratch, env=env, stdout=log,
                                 stderr=subprocess.STDOUT, start_new_session=True)
        try:
            deadline = time.monotonic() + 55
            while time.monotonic() < deadline:
                if child.poll() is not None:
                    log.seek(0)
                    raise RuntimeError(f'App exited {child.returncode}: {log.read()[-4000:]}')
                texts = []
                log.flush()
                texts.append((scratch / 'startup.log').read_text(errors='replace'))
                for path in (scratch / '.myagents' / 'logs').glob('unified-*.log'):
                    texts.append(path.read_text(errors='replace'))
                ports = re.findall(r'TCP health check passed[^\n]*on port (\d+)', '\n'.join(texts))
                for port in set(ports):
                    try:
                        # Ignore proxy environment for this scratch app's loopback check.
                        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                        with opener.open(f'http://127.0.0.1:{port}/health/ready', timeout=1) as response:
                            if response.status == 200:
                                print('App startup and Sidecar readiness passed')
                                return
                    except OSError:
                        pass
                time.sleep(0.5)
            log.seek(0)
            raise RuntimeError(f'App did not reach Sidecar readiness: {log.read()[-4000:]}')
        finally:
            # Stop only the smoke process group; never search/kill user processes.
            try:
                os.killpg(child.pid, signal.SIGTERM)
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=5)
            except ProcessLookupError:
                child.wait(timeout=5)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resources', type=Path, required=True)
    parser.add_argument('--app', type=Path, required=True)
    parser.add_argument('--startup', action='store_true')
    args = parser.parse_args()
    root, app = args.resources.resolve(), args.app.resolve()
    repo = Path(__file__).resolve().parent.parent
    document_root = root / 'document-processing' / 'v1'
    speech_root = root / 'speech-inference' / 'v1'
    document = check_manifest(document_root)
    speech = check_manifest(speech_root)
    for key in ('sha256', 'size', 'upstreamRevision'):
        if speech['onnxRuntime'][key] != document['files']['onnxRuntime'][key]:
            raise ValueError('Document and speech resources disagree about the shared ONNX Runtime')
    node = root / 'nodejs' / 'bin' / 'node'
    executables = [app, node, root / 'claude-agent-sdk' / 'claude',
                   document_root / document['worker']['path'],
                   speech_root / speech['files']['mediaWorker']['path']]
    with tempfile.TemporaryDirectory(prefix='myagents-linux-smoke-') as directory:
        scratch = Path(directory)
        env = {key: value for key, value in os.environ.items()
               if key in ('DISPLAY', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', 'XAUTHORITY')}
        env.update(HOME=str(scratch), XDG_CONFIG_HOME=str(scratch / 'config'),
                   XDG_CACHE_HOME=str(scratch / 'cache'), XDG_DATA_HOME=str(scratch / 'data'),
                   PATH='/usr/bin:/bin', LANG='C.UTF-8')
        for executable in executables:
            if not os.access(executable, os.X_OK) or not check_elf(executable):
                raise ValueError(f'Missing/non-executable Linux binary: {executable}')
            check_executable_dependencies(executable, env)
        for path in root.rglob('*'):
            if path.is_file() and ('.so' in path.name or path.suffix == '.node'):
                check_elf(path)
        runtime = json.loads((repo / 'scripts' / 'node-runtime.json').read_text())
        identity = json.loads(run([str(node), '-p',
                                  'JSON.stringify([process.versions.node,process.platform,process.arch])'], env=env, cwd=scratch))
        if identity != [runtime['node'], 'linux', 'x64']:
            raise ValueError(f'Wrong bundled Node identity: {identity}')
        npm = root / 'nodejs' / 'lib' / 'node_modules' / 'npm'
        if run([str(node), str(npm / 'bin' / 'npm-cli.js'), '--version'], env=env, cwd=scratch).strip() != runtime['npm']:
            raise ValueError('Wrong bundled npm version')
        # The SDK package version and the native Claude Code version are distinct.
        if not re.search(r'\d+\.\d+\.\d+', run([str(executables[2]), '--version'], env=env, cwd=scratch)):
            raise ValueError('Bundled Claude executable did not report a version')
        for script in ('server-dist.js', 'plugin-bridge-dist.mjs', 'cli/myagents.cjs'):
            run([str(node), '--check', str(root / script)], env=env, cwd=scratch)
        run([str(node), '-e', '''
            const {createRequire} = require('node:module');
            const path = require('node:path');
            const root = process.argv[1];
            const req = createRequire(path.join(root, 'package.json'));
            for (const name of ['playwright', 'playwright-core', '@playwright/mcp']) req.resolve(name);
            const sharp = req(path.join(root, 'sharp-runtime/node_modules/sharp'));
            sharp({create:{width:2,height:2,channels:3,background:'#ffffff'}}).png().toBuffer()
              .then(bytes => { if (!bytes.length) process.exit(1); });
        ''', str(root)], env=env, cwd=scratch)
        loader = root / 'tsx-runtime' / 'node_modules' / 'tsx' / 'dist' / 'esm' / 'index.mjs'
        run([str(node), '--import', str(loader), '-e', 'console.log("tsx ready")'], env=env, cwd=scratch)
        # Real shared-library loading catches dlopen dependencies which ldd(app) misses.
        libraries = load_native_libraries(document_root, document, speech_root, speech)
        # Exercise the existing Worker protocol with a tiny offline document.
        sample = scratch / 'sample.html'
        sample.write_text('<html><body><h1>Ubuntu package smoke</h1><p>Offline conversion.</p></body></html>')
        run([str(node), str(repo / 'scripts' / 'document-worker-smoke.mjs'), str(sample),
             str(document_root)], env=env, cwd=scratch, timeout=90)
        if args.startup:
            check_startup(app, env, scratch)
        del libraries
    print('Linux package resources, manifests, native loading and document Worker passed')


if __name__ == '__main__':
    main()
