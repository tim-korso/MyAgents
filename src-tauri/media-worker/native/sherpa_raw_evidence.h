// MyAgents' bounded raw-evidence extension to the pinned sherpa-onnx source.
// This is copied into csrc by the verified source-preparation step.
#ifndef MYAGENTS_SHERPA_RAW_EVIDENCE_H_
#define MYAGENTS_SHERPA_RAW_EVIDENCE_H_

#include <algorithm>
#include <cstdint>
#include <stdexcept>
#include <vector>

namespace sherpa_onnx {

enum class RawEmbeddingStatus : uint32_t {
  kAvailable = 0,
  kNoExclusiveSpeech = 1,
  kNotReady = 2,
  kInvalidVector = 3,
};

struct RawSpeechInterval {
  int32_t start;
  int32_t end;
};

struct RawSpeakerEvidence {
  uint32_t chunk_index = 0;
  uint32_t slot = 0;
  int32_t chunk_start = 0;
  int32_t chunk_end = 0;
  uint32_t clean_samples = 0;
  RawEmbeddingStatus status = RawEmbeddingStatus::kNoExclusiveSpeech;
  std::vector<RawSpeechInterval> activity;
  std::vector<RawSpeechInterval> clean;
  std::vector<float> embedding;

  RawSpeakerEvidence() = default;
  RawSpeakerEvidence(const RawSpeakerEvidence &) = delete;
  RawSpeakerEvidence &operator=(const RawSpeakerEvidence &) = delete;
  RawSpeakerEvidence(RawSpeakerEvidence &&) noexcept = default;
  RawSpeakerEvidence &operator=(RawSpeakerEvidence &&) noexcept = delete;
  ~RawSpeakerEvidence() {
    for (auto &sample : embedding) {
      volatile float *value = &sample;
      *value = 0;
    }
  }
};

inline std::vector<RawSpeechInterval> ExcludeRawIntervals(
    const std::vector<RawSpeechInterval> &activity,
    const std::vector<RawSpeechInterval> &excluded) {
  std::vector<RawSpeechInterval> kept;
  for (const auto &interval : activity) {
    int32_t start = interval.start;
    for (const auto &skip : excluded) {
      if (skip.end <= start) continue;
      if (skip.start >= interval.end) break;
      if (skip.start > start) kept.push_back({start, skip.start});
      start = std::max(start, skip.end);
    }
    if (start < interval.end) kept.push_back({start, interval.end});
  }
  return kept;
}

using RawDiarizationEvidence = std::vector<RawSpeakerEvidence>;

// Adjacent labels meet halfway between receptive-field centres. Preserve the
// actual grid for short/padded input; never stretch all model frames over n.
// Outer edges are clipped to the real chunk, not an invented padding interval.
inline int32_t RawFrameBoundary(int32_t frame, int32_t frames,
                                int32_t receptive_size, int32_t shift,
                                int32_t chunk_start, int32_t chunk_end) {
  if (frames <= 0 || frame < 0 || frame > frames || receptive_size <= 0 ||
      shift <= 0 || chunk_start < 0 || chunk_end <= chunk_start) {
    throw std::invalid_argument("Invalid raw segmentation coordinates");
  }
  if (frame == 0) return chunk_start;
  if (frame == frames) return chunk_end;
  const int64_t centre_boundary = static_cast<int64_t>(chunk_start) +
      (receptive_size - shift) / 2 + static_cast<int64_t>(frame) * shift;
  return static_cast<int32_t>(std::clamp<int64_t>(centre_boundary,
                                                chunk_start, chunk_end));
}

template <typename IsActive>
std::vector<RawSpeechInterval> RawActivityIntervals(
    int32_t frames, int32_t receptive_size, int32_t shift,
    int32_t chunk_start, int32_t chunk_end, IsActive is_active) {
  std::vector<RawSpeechInterval> result;
  int32_t active_start = -1;
  for (int32_t frame = 0; frame <= frames; ++frame) {
    const int32_t boundary = RawFrameBoundary(frame, frames, receptive_size,
                                             shift, chunk_start, chunk_end);
    const bool active = frame < frames && boundary < chunk_end && is_active(frame);
    if (active && active_start < 0) active_start = boundary;
    if (!active && active_start >= 0) {
      if (boundary > active_start) result.push_back({active_start, boundary});
      active_start = -1;
    }
  }
  return result;
}

}  // namespace sherpa_onnx
#endif  // MYAGENTS_SHERPA_RAW_EVIDENCE_H_
