# Speech inference native bundle notices

MyAgents ships a target-specific media Worker and adapter under
`speech-inference/v1`. The bundle intentionally does not contain ONNX Runtime:
it references and verifies the single App-owned ONNX Runtime file from the
document-processing resource bundle.

The native speech bundle is built from the exact revisions recorded in
`src-tauri/document-worker/resource-lock.json`:

- sherpa-onnx and its C/C++ dependency graph, under their corresponding
  Apache-2.0, BSD-3-Clause, MIT, MPL-2.0, and upstream notice terms;
- `opus2` 0.4.0, `libopus_sys` 0.3.3, and bundled libopus, under their
  corresponding Apache-2.0, MIT, and BSD-style terms;
- Sonora 0.2.0 and its exactly locked AEC3, AGC2, common-audio, FFT, NS and
  SIMD crates, under BSD-3-Clause, for the AEC3 analysis path (AGC/NS remain
  disabled). The AEC3 crate shares Sonora’s repository-wide BSD notice;
- `rubato` 0.16.2 under MIT, and `num-traits` 0.2.19 under MIT OR Apache-2.0,
  for bounded source-clock resampling;
- hclust-cpp, already in the locked native graph, performs both local and
  global complete-link clustering; HDBSCAN is no longer shipped;
- MyAgents media Worker, ABI v2 adapter and controlled sherpa raw-activity /
  exclusive-speech embedding extension, under AGPL-3.0-only.

The adjacent `legal/` inventory contains the exact license files copied from
the source trees used for the build. The bundle manifest hashes every native
artifact and every legal file after platform signing.
