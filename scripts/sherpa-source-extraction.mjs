import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHERPA_BUILD_MEMBERS = Object.freeze([
  'CMakeLists.txt',
  'LICENSE',
  'cmake',
  'sherpa-onnx',
]);

const WINDOWS_ORT_IMPORT_BROKEN = `    elseif(WIN32)
      if(SHERPA_ONNX_ENABLE_GPU)
        set(location_onnxruntime_lib $ENV{SHERPA_ONNXRUNTIME_LIB_DIR}/onnxruntime.dll)
        set(location_onnxruntime_lib2 $ENV{SHERPA_ONNXRUNTIME_LIB_DIR}/onnxruntime.lib)
      else()
        set(location_onnxruntime_lib $ENV{SHERPA_ONNXRUNTIME_LIB_DIR}/onnxruntime.lib)
        if(SHERPA_ONNX_ENABLE_DIRECTML)
          include(onnxruntime-win-x64-directml)
        endif()
      endif()
`;

const WINDOWS_ORT_IMPORT_FIXED = `    elseif(WIN32)
      set(location_onnxruntime_lib $ENV{SHERPA_ONNXRUNTIME_LIB_DIR}/onnxruntime.dll)
      set(location_onnxruntime_lib2 $ENV{SHERPA_ONNXRUNTIME_LIB_DIR}/onnxruntime.lib)
      if(SHERPA_ONNX_ENABLE_DIRECTML)
        include(onnxruntime-win-x64-directml)
      endif()
`;

function requireEntry(path, kind) {
  const metadata = lstatSync(path);
  const valid =
    !metadata.isSymbolicLink() &&
    (kind === 'file' ? metadata.isFile() : metadata.isDirectory());
  if (!valid) {
    throw new Error(`Sherpa build source ${kind} is unavailable: ${path}`);
  }
}

export function patchSherpaWindowsOnnxRuntimeImport(sourceRoot) {
  const cmakePath = join(sourceRoot, 'cmake', 'onnxruntime.cmake');
  requireEntry(cmakePath, 'file');
  const source = readFileSync(cmakePath, 'utf8');
  if (source.includes(WINDOWS_ORT_IMPORT_FIXED)) {
    return false;
  }
  const firstMatch = source.indexOf(WINDOWS_ORT_IMPORT_BROKEN);
  if (
    firstMatch < 0 ||
    source.indexOf(WINDOWS_ORT_IMPORT_BROKEN, firstMatch + 1) >= 0
  ) {
    throw new Error(
      'Locked Sherpa ONNX Runtime CMake no longer matches the expected Windows CPU import block',
    );
  }
  writeFileSync(
    cmakePath,
    source.replace(WINDOWS_ORT_IMPORT_BROKEN, WINDOWS_ORT_IMPORT_FIXED),
    'utf8',
  );
  return true;
}

export function patchHclustWindowsFenvPragma(sourceRoot) {
  const sourcePath = join(sourceRoot, 'fastcluster_dm.cpp');
  requireEntry(sourcePath, 'file');
  const source = readFileSync(sourcePath, 'utf8');
  const original = '#pragma STDC FENV_ACCESS on';
  // The locked upstream explicitly allows ignoring this pragma. MSVC already
  // ignores it with C4068; omit only the unsupported directive, keeping fenv
  // includes/checks and the directive for other compilers intact.
  const patched = `#ifndef _MSC_VER\n${original}\n#endif`;
  if (source.includes(patched)) {
    return false;
  }
  const firstMatch = source.indexOf(original);
  if (firstMatch < 0 || source.indexOf(original, firstMatch + 1) >= 0) {
    throw new Error(
      'Locked hclust source no longer matches the expected FENV_ACCESS pragma',
    );
  }
  writeFileSync(sourcePath, source.replace(original, patched), 'utf8');
  return true;
}

// These are exact files from the locked archive, not pattern matches against
// an arbitrary upstream revision. The four small extension files stay beside
// our native adapter and are already included in its build fingerprint.
export function patchSherpaRawEvidence(sourceRoot) {
  const nativeRoot = join(dirname(fileURLToPath(import.meta.url)), '../src-tauri/media-worker/native');
  const fragment = (name) => readFileSync(join(nativeRoot, name), 'utf8').replaceAll('\r\n', '\n');
  const declaration = `  RawDiarizationEvidence ProcessRaw(
      const float *audio, int32_t n,
      OfflineSpeakerDiarizationProgressCallback callback = nullptr,
      void *callback_arg = nullptr,
      const std::vector<RawSpeechInterval> &excluded = {}) const;\n\n`;
  const forward = `RawDiarizationEvidence OfflineSpeakerDiarization::ProcessRaw(
    const float *audio, int32_t n,
    OfflineSpeakerDiarizationProgressCallback callback, void *callback_arg,
    const std::vector<RawSpeechInterval> &excluded) const {
  return impl_->ProcessRaw(audio, n, std::move(callback), callback_arg, excluded);
}\n\n`;
  const virtualDeclaration = declaration.replace('  RawDiarizationEvidence', '  virtual RawDiarizationEvidence').replace(') const;', ') const = 0;');
  const edits = [
    ['sherpa-onnx/csrc/offline-speaker-diarization.h', '5fc4f0f93c1e414b2333fee13524d993a82786e782ca129b6c5b77bf8861b5cc', [
      ['#include <string>', '#include <string>\n#include "sherpa-onnx/csrc/myagents-raw-evidence.h"'],
      ['  OfflineSpeakerDiarizationResult Process(', `${declaration}  OfflineSpeakerDiarizationResult Process(`],
    ]],
    ['sherpa-onnx/csrc/offline-speaker-diarization-impl.h', '16a9f61116710c430b69df0786a5150f4a66e8153dd1a7e855bf5c5a1b1dc5e5', [
      ['  virtual OfflineSpeakerDiarizationResult Process(', `${virtualDeclaration}  virtual OfflineSpeakerDiarizationResult Process(`],
    ]],
    ['sherpa-onnx/csrc/offline-speaker-diarization.cc', '01f15accafd77fa12fcc12487de400e1117427064e4bc666c515e90dbcb56b62', [
      ['OfflineSpeakerDiarizationResult OfflineSpeakerDiarization::Process(', `${forward}OfflineSpeakerDiarizationResult OfflineSpeakerDiarization::Process(`],
    ]],
    ['sherpa-onnx/csrc/offline-speaker-diarization-pyannote-impl.h', '20dbd7c8877ca99581ed8d2eda7c5779529d2e5143916173949a0910a4e5b3e1', [
      [' private:\n  void LogTotal(', `${fragment('sherpa_raw_evidence.inc')} private:\n  void LogTotal(`],
      ['    powerset_mapping_ = Matrix2DInt32(num_classes, num_speakers);', `    if (num_speakers < 1 || num_speakers > 3 || powerset_max_classes < 1 ||
        powerset_max_classes > 2 || num_classes != 1 + num_speakers +
            (powerset_max_classes == 2 ? num_speakers * (num_speakers - 1) / 2 : 0)) {
      throw std::invalid_argument("Unsupported raw segmentation powerset");
    }
    powerset_mapping_ = Matrix2DInt32(num_classes, num_speakers);`],
      ['    Matrix2D m(out_shape[1], out_shape[2]);', `    if (out_shape.size() != 3 || out_shape[0] != 1 || out_shape[1] <= 0 ||
        out_shape[1] > 4096 || out_shape[2] != meta_data.num_classes) {
      throw std::runtime_error("Invalid raw segmentation tensor shape");
    }
    Matrix2D m(out_shape[1], out_shape[2]);`],
    ]],
    ['sherpa-onnx/c-api/sherpa-onnx-symbols-c.exp', '7cd5e8a41aa10ec4109c146d387b4ae8ccf8f9675f6b5483b3b25c3744604dc9', [
      ['_SherpaOnnxOfflineSpeakerDiarizationProcess\n', '_SherpaOnnxOfflineSpeakerDiarizationProcess\n_SherpaOnnxOfflineSpeakerDiarizationProcessRawV1\n'],
    ]],
    ['sherpa-onnx/c-api/c-api.cc', '7b0b675d29b8d308d7ebc9cfdd3a6c3f065bb4b6709b032759d623659e279e7b', [
      ['#include "sherpa-onnx/c-api/c-api.h"', '#include "sherpa-onnx/c-api/c-api.h"\n#include "sherpa-onnx/c-api/myagents-raw-evidence.h"'],
      ['#else\n\nconst SherpaOnnxOfflineSpeakerDiarization *\nSherpaOnnxCreateOfflineSpeakerDiarization(', `${fragment('sherpa_raw_c_api.inc')}#else\n\nconst SherpaOnnxOfflineSpeakerDiarization *\nSherpaOnnxCreateOfflineSpeakerDiarization(`],
    ]],
  ];
  const writes = [];
  for (const [relative, expectedHash, replacements] of edits) {
    const path = join(sourceRoot, relative);
    requireEntry(path, 'file');
    const current = readFileSync(path, 'utf8');
    let original = current;
    for (const [before, after] of [...replacements].reverse()) {
      if (original.includes(after)) original = original.replace(after, before);
    }
    if (createHash('sha256').update(original).digest('hex') !== expectedHash) {
      throw new Error(`Locked Sherpa raw-evidence source does not match: ${relative}`);
    }
    let patched = original;
    for (const [before, after] of replacements) {
      if (patched.split(before).length !== 2) throw new Error(`Ambiguous raw-evidence edit: ${relative}`);
      patched = patched.replace(before, after);
    }
    if (patched !== current) writes.push([path, patched]);
  }
  for (const [name, destination] of [
    ['sherpa_raw_evidence.h', 'sherpa-onnx/csrc/myagents-raw-evidence.h'],
    ['sherpa_raw_c_api.h', 'sherpa-onnx/c-api/myagents-raw-evidence.h'],
  ]) {
    const path = join(sourceRoot, destination);
    const bytes = fragment(name);
    try {
      requireEntry(path, 'file');
      if (readFileSync(path, 'utf8') !== bytes) throw new Error('Raw-evidence header differs');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      writes.push([path, bytes]);
    }
  }
  for (const [path, bytes] of writes) writeFileSync(path, bytes, 'utf8');
  return writes.length > 0;
}

export function extractSherpaBuildSource({
  archive,
  destination,
  archiveRoot,
  runTar = execFileSync,
}) {
  if (!/^[A-Za-z0-9._-]+$/.test(archiveRoot ?? '')) {
    throw new Error('Sherpa source lock has an invalid archive root');
  }
  requireEntry(archive, 'file');
  mkdirSync(destination, { recursive: true });
  runTar(
    'tar',
    [
      '-xf',
      archive,
      '-C',
      destination,
      ...SHERPA_BUILD_MEMBERS.map((member) => `${archiveRoot}/${member}`),
    ],
    { stdio: 'inherit' },
  );

  const sourceRoot = join(destination, archiveRoot);
  requireEntry(join(sourceRoot, 'CMakeLists.txt'), 'file');
  requireEntry(join(sourceRoot, 'LICENSE'), 'file');
  requireEntry(join(sourceRoot, 'cmake'), 'directory');
  requireEntry(join(sourceRoot, 'sherpa-onnx'), 'directory');
  requireEntry(join(sourceRoot, 'sherpa-onnx', 'CMakeLists.txt'), 'file');
  return sourceRoot;
}
