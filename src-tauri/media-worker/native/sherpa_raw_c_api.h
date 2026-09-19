// Product-owned extension, copied beside the pinned sherpa C API.
#ifndef MYAGENTS_SHERPA_RAW_C_API_H_
#define MYAGENTS_SHERPA_RAW_C_API_H_
#include "sherpa-onnx/c-api/c-api.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct SherpaOnnxRawSpeechInterval {
  int32_t start;
  int32_t end;
} SherpaOnnxRawSpeechInterval;

// All views are borrowed for the visitor call only. The visitor must copy
// wanted evidence and cannot free or retain these pointers.
typedef struct SherpaOnnxRawSpeakerEvidence {
  uint32_t struct_size;
  uint32_t chunk_index;
  uint32_t slot;
  int32_t chunk_start;
  int32_t chunk_end;
  uint32_t clean_samples;
  uint32_t embedding_status;
  const float *embedding;
  uint32_t embedding_dimension;
  const SherpaOnnxRawSpeechInterval *activity;
  uint32_t activity_count;
  const SherpaOnnxRawSpeechInterval *clean;
  uint32_t clean_count;
} SherpaOnnxRawSpeakerEvidence;

typedef int32_t (*SherpaOnnxRawEvidenceVisitor)(
    const SherpaOnnxRawSpeakerEvidence *evidence, void *arg);

// 0 success; 1 invalid argument; 2 inference/model error; 3 resource limit;
// 4 visitor declined. No C++ exception or owning allocation crosses this ABI.
SHERPA_ONNX_API int32_t SherpaOnnxOfflineSpeakerDiarizationProcessRawV1(
    const SherpaOnnxOfflineSpeakerDiarization *sd, const float *samples,
    int32_t n, const SherpaOnnxRawSpeechInterval *excluded, uint32_t excluded_count,
    SherpaOnnxOfflineSpeakerDiarizationProgressCallback progress,
    SherpaOnnxRawEvidenceVisitor visitor, void *arg);

#ifdef __cplusplus
}
#endif
#endif  // MYAGENTS_SHERPA_RAW_C_API_H_
