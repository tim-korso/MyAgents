#include "myagents_speech_adapter.h"
#include "bounded_vad.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstring>
#include <limits>
#include <memory>
#include <new>
#include <string>
#include <utility>
#include <vector>

#include "fastcluster-all-in-one.h"  // NOLINT
#include "sherpa-onnx/c-api/myagents-raw-evidence.h"

#ifndef MYAGENTS_SHERPA_ONNX_COMMIT
#define MYAGENTS_SHERPA_ONNX_COMMIT \
  "1cb484af5e69d3c7803c1eb0b3b5ab8041e0e911"
#endif

static_assert(sizeof(void *) == 8, "MyAgents desktop targets require a 64-bit ABI");
static_assert(sizeof(MyAgentsSpeechBuildInfo) == 40);
static_assert(sizeof(MyAgentsSpeechUtf8Buffer) == 16);
static_assert(sizeof(MyAgentsSpeechAsrConfig) == 32);
static_assert(sizeof(MyAgentsSpeechAsrResult) == 72);
static_assert(sizeof(MyAgentsSpeechVadConfig) == 40);
static_assert(sizeof(MyAgentsSpeechVadSegment) == 32);
static_assert(sizeof(MyAgentsSpeechDiarizerConfig) == 32);
static_assert(sizeof(MyAgentsSpeechLocalSpeaker) == 32);
static_assert(sizeof(MyAgentsSpeechLocalSegment) == 24);
static_assert(sizeof(MyAgentsSpeechInterval) == 16);
static_assert(sizeof(MyAgentsSpeechDiarizationOutput) == 72);
static_assert(sizeof(MyAgentsSpeechAdapterApiV2) == 136);

namespace {

constexpr uint32_t kVadWindowSamples = 512;
constexpr float kVadBufferSeconds = 35.0f;

bool HasText(const char *value) { return value != nullptr && value[0] != '\0'; }

bool ValidThreads(uint32_t value) { return value >= 1 && value <= 2; }

bool ValidFiniteRange(float value, float lower, float upper) {
  return std::isfinite(value) && value >= lower && value <= upper;
}

bool ValidSamples(const float *samples, uint32_t count, uint32_t maximum) {
  if (samples == nullptr || count == 0 || count > maximum) return false;
  for (uint32_t index = 0; index != count; ++index) {
    if (!std::isfinite(samples[index]) || samples[index] < -1.001f ||
        samples[index] > 1.001f) {
      return false;
    }
  }
  return true;
}

MyAgentsSpeechStatus WriteUtf8(const char *source,
                               MyAgentsSpeechUtf8Buffer *destination) {
  if (destination == nullptr) return MYAGENTS_SPEECH_STATUS_INVALID_ARGUMENT;
  const char *value = source == nullptr ? "" : source;
  const size_t length = std::strlen(value);
  if (length > MYAGENTS_SPEECH_MAX_TEXT_BYTES) {
    return MYAGENTS_SPEECH_STATUS_RESOURCE_LIMIT;
  }
  destination->length = static_cast<uint32_t>(length);
  if (destination->capacity <= length || destination->data == nullptr) {
    return MYAGENTS_SPEECH_STATUS_BUFFER_TOO_SMALL;
  }
  std::memcpy(destination->data, value, length);
  destination->data[length] = '\0';
  return MYAGENTS_SPEECH_STATUS_OK;
}

MyAgentsSpeechStatus MergeBufferStatus(MyAgentsSpeechStatus current,
                                       MyAgentsSpeechStatus next) {
  if (next == MYAGENTS_SPEECH_STATUS_OK) return current;
  if (current == MYAGENTS_SPEECH_STATUS_OK ||
      next != MYAGENTS_SPEECH_STATUS_BUFFER_TOO_SMALL) {
    return next;
  }
  return current;
}

}  // namespace

struct MyAgentsSpeechAsr {
  const SherpaOnnxOfflineRecognizer *recognizer = nullptr;
};

struct MyAgentsSpeechVad {
  const SherpaOnnxVoiceActivityDetector *vad = nullptr;
  BoundedVadInput input;
  uint32_t max_active_samples = 0;
};

struct MyAgentsSpeechDiarizer {
  const SherpaOnnxOfflineSpeakerDiarization *diarizer = nullptr;
};

struct MyAgentsSpeechDiarizationResult {
  std::vector<MyAgentsSpeechLocalSpeaker> speakers;
  std::vector<MyAgentsSpeechLocalSegment> segments;
  std::vector<MyAgentsSpeechLocalSegment> clean_segments;
  std::vector<float> embeddings;
  ~MyAgentsSpeechDiarizationResult() {
    for (auto &sample : embeddings) {
      volatile float *value = &sample;
      *value = 0;
    }
  }
};

namespace {

MyAgentsSpeechStatus GetBuildInfo(MyAgentsSpeechBuildInfo *out) {
  if (out == nullptr || out->struct_size != sizeof(*out)) {
    return MYAGENTS_SPEECH_STATUS_INVALID_ARGUMENT;
  }
  out->abi_version = MYAGENTS_SPEECH_ADAPTER_ABI_VERSION;
  out->sherpa_onnx_version = SherpaOnnxGetVersionStr();
  out->sherpa_onnx_commit = MYAGENTS_SHERPA_ONNX_COMMIT;
  out->onnx_runtime_version = SherpaOnnxGetOnnxruntimeVersionStr();
  out->sample_rate = MYAGENTS_SPEECH_SAMPLE_RATE;
  out->embedding_dimension = MYAGENTS_SPEECH_EMBEDDING_DIMENSION;
  if (!HasText(out->sherpa_onnx_version) ||
      !HasText(out->onnx_runtime_version)) {
    return MYAGENTS_SPEECH_STATUS_UNAVAILABLE;
  }
  return MYAGENTS_SPEECH_STATUS_OK;
}

MyAgentsSpeechStatus CreateAsr(const MyAgentsSpeechAsrConfig *config,
                               MyAgentsSpeechAsr **out) {
  if (out == nullptr) return MYAGENTS_SPEECH_STATUS_INVALID_ARGUMENT;
  *out = nullptr;
  if (config == nullptr || config->struct_size != sizeof(*config) ||
      !HasText(config->sense_voice_model) || !HasText(config->tokens) ||
      !ValidThreads(config->num_threads) ||
      (config->use_itn != 0 && config->use_itn != 1)) {
    return MYAGENTS_SPEECH_STATUS_INVALID_ARGUMENT;
  }
  try {
    SherpaOnnxOfflineRecognizerConfig recognizer_config{};
    recognizer_config.feat_config.sample_rate = MYAGENTS_SPEECH_SAMPLE_RATE;
    recognizer_config.feat_config.feature_dim = 80;
    recognizer_config.model_config.sense_voice.model =
        config->sense_voice_model;
    recognizer_config.model_config.sense_voice.language = "auto";
    recognizer_config.model_config.sense_voice.use_itn = config->use_itn;
    recognizer_config.model_config.tokens = config->tokens;
    recognizer_config.model_config.num_threads =
        static_cast<int32_t>(config->num_threads);
    recognizer_config.model_config.provider = "cpu";
    recognizer_config.decoding_method = "greedy_search";
    const auto *recognizer =
        SherpaOnnxCreateOfflineRecognizer(&recognizer_config);
    if (recognizer == nullptr) return MYAGENTS_SPEECH_STATUS_MODEL_ERROR;
    auto *asr = new (std::nothrow) MyAgentsSpeechAsr{};
    if (asr == nullptr) {
      SherpaOnnxDestroyOfflineRecognizer(recognizer);
      return MYAGENTS_SPEECH_STATUS_RESOURCE_LIMIT;
    }
    asr->recognizer = recognizer;
    *out = asr;
    return MYAGENTS_SPEECH_STATUS_OK;
  } catch (...) {
    return MYAGENTS_SPEECH_STATUS_MODEL_ERROR;
  }
}

void DestroyAsr(MyAgentsSpeechAsr *asr) {
  if (asr == nullptr) return;
  if (asr->recognizer != nullptr) {
    SherpaOnnxDestroyOfflineRecognizer(asr->recognizer);
  }
  delete asr;
}

MyAgentsSpeechStatus Transcribe(MyAgentsSpeechAsr *asr, const float *samples,
                                uint32_t sample_count,
                                MyAgentsSpeechAsrResult *out) {
  if (asr == nullptr || asr->recognizer == nullptr || out == nullptr ||
      out->struct_size != sizeof(*out) ||
      !ValidSamples(samples, sample_count, MYAGENTS_SPEECH_MAX_ASR_SAMPLES)) {
    return MYAGENTS_SPEECH_STATUS_INVALID_ARGUMENT;
  }
  const SherpaOnnxOfflineStream *stream = nullptr;
  const SherpaOnnxOfflineRecognizerResult *result = nullptr;
  try {
    stream = SherpaOnnxCreateOfflineStream(asr->recognizer);
    if (stream == nullptr) return MYAGENTS_SPEECH_STATUS_INFERENCE_ERROR;
    SherpaOnnxAcceptWaveformOffline(stream, MYAGENTS_SPEECH_SAMPLE_RATE,
                                   samples, static_cast<int32_t>(sample_count));
    SherpaOnnxDecodeOfflineStream(asr->recognizer, stream);
    result = SherpaOnnxGetOfflineStreamResult(stream);
    if (result == nullptr) {
      SherpaOnnxDestroyOfflineStream(stream);
      return MYAGENTS_SPEECH_STATUS_INFERENCE_ERROR;
    }
    MyAgentsSpeechStatus status = MYAGENTS_SPEECH_STATUS_OK;
    status = MergeBufferStatus(status, WriteUtf8(result->text, &out->text));
    status =
        MergeBufferStatus(status, WriteUtf8(result->lang, &out->language));
    status =
        MergeBufferStatus(status, WriteUtf8(result->emotion, &out->emotion));
    status =
        MergeBufferStatus(status, WriteUtf8(result->event, &out->event));
    SherpaOnnxDestroyOfflineRecognizerResult(result);
    SherpaOnnxDestroyOfflineStream(stream);
    return status;
  } catch (...) {
    if (result != nullptr) SherpaOnnxDestroyOfflineRecognizerResult(result);
    if (stream != nullptr) SherpaOnnxDestroyOfflineStream(stream);
    return MYAGENTS_SPEECH_STATUS_INFERENCE_ERROR;
  }
}

MyAgentsSpeechStatus CreateVad(const MyAgentsSpeechVadConfig *config,
                               MyAgentsSpeechVad **out) {
  if (out == nullptr) return MYAGENTS_SPEECH_STATUS_INVALID_ARGUMENT;
  *out = nullptr;
  if (config == nullptr || config->struct_size != sizeof(*config) ||
      !HasText(config->silero_model) || !ValidThreads(config->num_threads) ||
      !ValidFiniteRange(config->threshold, 0.01f, 0.99f) ||
      !ValidFiniteRange(config->min_silence_seconds, 0.05f, 10.0f) ||
      !ValidFiniteRange(config->min_speech_seconds, 0.05f, 10.0f) ||
      !ValidFiniteRange(config->max_speech_seconds, 1.0f, 30.0f)) {
    return MYAGENTS_SPEECH_STATUS_INVALID_ARGUMENT;
  }
  try {
    SherpaOnnxVadModelConfig vad_config{};
    vad_config.silero_vad.model = config->silero_model;
    vad_config.silero_vad.threshold = config->threshold;
    vad_config.silero_vad.min_silence_duration = config->min_silence_seconds;
    vad_config.silero_vad.min_speech_duration = config->min_speech_seconds;
    vad_config.silero_vad.max_speech_duration = config->max_speech_seconds;
    vad_config.silero_vad.window_size = kVadWindowSamples;
    vad_config.sample_rate = MYAGENTS_SPEECH_SAMPLE_RATE;
    vad_config.num_threads = static_cast<int32_t>(config->num_threads);
    vad_config.provider = "cpu";
    const auto *detector =
        SherpaOnnxCreateVoiceActivityDetector(&vad_config, kVadBufferSeconds);
    if (detector == nullptr) return MYAGENTS_SPEECH_STATUS_MODEL_ERROR;
    auto *vad = new (std::nothrow) MyAgentsSpeechVad{};
    if (vad == nullptr) {
      SherpaOnnxDestroyVoiceActivityDetector(detector);
      return MYAGENTS_SPEECH_STATUS_RESOURCE_LIMIT;
    }
    vad->vad = detector;
    // Detection starts after the model's minimum-speech lookback. Reserve that
    // history and two windows so a forced endpoint stays within the configured
    // duration even when the model never lowers its speech probability.
    const float active_budget =
        (config->max_speech_seconds - config->min_speech_seconds) *
            MYAGENTS_SPEECH_SAMPLE_RATE - 2 * kVadWindowSamples;
    vad->max_active_samples = static_cast<uint32_t>(
        std::max(static_cast<float>(kVadWindowSamples), active_budget));
    *out = vad;
    return MYAGENTS_SPEECH_STATUS_OK;
  } catch (...) {
    return MYAGENTS_SPEECH_STATUS_MODEL_ERROR;
  }
}

void DestroyVad(MyAgentsSpeechVad *vad) {
  if (vad == nullptr) return;
  if (vad->vad != nullptr) SherpaOnnxDestroyVoiceActivityDetector(vad->vad);
  delete vad;
}

MyAgentsSpeechStatus VadAccept(MyAgentsSpeechVad *vad, const float *samples,
                               uint32_t sample_count) {
  if (vad == nullptr || vad->vad == nullptr ||
      !ValidSamples(samples, sample_count,
                    MYAGENTS_SPEECH_MAX_PCM_CHUNK_SAMPLES)) {
    return MYAGENTS_SPEECH_STATUS_INVALID_ARGUMENT;
  }
  try {
    vad->input.Feed(
        samples, sample_count, kVadWindowSamples, vad->max_active_samples,
        [vad](const float *pcm, uint32_t count) {
          SherpaOnnxVoiceActivityDetectorAcceptWaveform(
              vad->vad, pcm, static_cast<int32_t>(count));
        },
        [vad] { return SherpaOnnxVoiceActivityDetectorDetected(vad->vad) != 0; },
        [vad] { SherpaOnnxVoiceActivityDetectorFlush(vad->vad); });
    return MYAGENTS_SPEECH_STATUS_OK;
  } catch (...) {
    return MYAGENTS_SPEECH_STATUS_INFERENCE_ERROR;
  }
}

MyAgentsSpeechStatus VadFlush(MyAgentsSpeechVad *vad) {
  if (vad == nullptr || vad->vad == nullptr) {
    return MYAGENTS_SPEECH_STATUS_INVALID_ARGUMENT;
  }
  try {
    SherpaOnnxVoiceActivityDetectorFlush(vad->vad);
    vad->input.Reset();
    return MYAGENTS_SPEECH_STATUS_OK;
  } catch (...) {
    return MYAGENTS_SPEECH_STATUS_INFERENCE_ERROR;
  }
}

MyAgentsSpeechStatus VadPop(MyAgentsSpeechVad *vad,
                            MyAgentsSpeechVadSegment *out) {
  if (vad == nullptr || vad->vad == nullptr || out == nullptr ||
      out->struct_size != sizeof(*out)) {
    return MYAGENTS_SPEECH_STATUS_INVALID_ARGUMENT;
  }
  if (SherpaOnnxVoiceActivityDetectorEmpty(vad->vad) != 0) {
    out->sample_count = 0;
    return MYAGENTS_SPEECH_STATUS_UNAVAILABLE;
  }
  const SherpaOnnxSpeechSegment *segment = nullptr;
  try {
    segment = SherpaOnnxVoiceActivityDetectorFront(vad->vad);
    if (segment == nullptr || segment->start < 0 || segment->n <= 0 ||
        segment->samples == nullptr ||
        static_cast<uint32_t>(segment->n) > MYAGENTS_SPEECH_MAX_ASR_SAMPLES) {
      if (segment != nullptr) SherpaOnnxDestroySpeechSegment(segment);
      SherpaOnnxVoiceActivityDetectorPop(vad->vad);
      return MYAGENTS_SPEECH_STATUS_INFERENCE_ERROR;
    }
    out->start_sample = static_cast<uint64_t>(segment->start);
    out->sample_count = static_cast<uint32_t>(segment->n);
    if (out->samples == nullptr || out->sample_capacity < out->sample_count) {
      SherpaOnnxDestroySpeechSegment(segment);
      return MYAGENTS_SPEECH_STATUS_BUFFER_TOO_SMALL;
    }
    std::copy_n(segment->samples, segment->n, out->samples);
    SherpaOnnxDestroySpeechSegment(segment);
    SherpaOnnxVoiceActivityDetectorPop(vad->vad);
    return MYAGENTS_SPEECH_STATUS_OK;
  } catch (...) {
    if (segment != nullptr) SherpaOnnxDestroySpeechSegment(segment);
    return MYAGENTS_SPEECH_STATUS_INFERENCE_ERROR;
  }
}

MyAgentsSpeechStatus VadReset(MyAgentsSpeechVad *vad) {
  if (vad == nullptr || vad->vad == nullptr) {
    return MYAGENTS_SPEECH_STATUS_INVALID_ARGUMENT;
  }
  try {
    SherpaOnnxVoiceActivityDetectorReset(vad->vad);
    vad->input.Reset();
    return MYAGENTS_SPEECH_STATUS_OK;
  } catch (...) {
    return MYAGENTS_SPEECH_STATUS_INFERENCE_ERROR;
  }
}

MyAgentsSpeechStatus CreateDiarizer(
    const MyAgentsSpeechDiarizerConfig *config, MyAgentsSpeechDiarizer **out) {
  if (out == nullptr) return MYAGENTS_SPEECH_STATUS_INVALID_ARGUMENT;
  *out = nullptr;
  if (config == nullptr || config->struct_size != sizeof(*config) ||
      !HasText(config->segmentation_model) || !HasText(config->embedding_model) ||
      !ValidThreads(config->num_threads) ||
      !ValidFiniteRange(config->segmentation_window_shift_ratio, 0.01f, 1.0f)) {
    return MYAGENTS_SPEECH_STATUS_INVALID_ARGUMENT;
  }
  const SherpaOnnxOfflineSpeakerDiarization *diarizer = nullptr;
  try {
    SherpaOnnxOfflineSpeakerDiarizationConfig native{};
    native.segmentation.pyannote.model = config->segmentation_model;
    native.segmentation.pyannote.window_shift_ratio = config->segmentation_window_shift_ratio;
    native.segmentation.num_threads = static_cast<int32_t>(config->num_threads);
    native.segmentation.provider = "cpu";
    native.embedding.model = config->embedding_model;
    native.embedding.num_threads = static_cast<int32_t>(config->num_threads);
    native.embedding.provider = "cpu";
    // Required by upstream construction; ProcessRaw never runs its clustering
    // or final-turn reconstruction. The single internal extractor is reused.
    native.clustering.threshold = 0.5f;
    diarizer = SherpaOnnxCreateOfflineSpeakerDiarization(&native);
    if (diarizer == nullptr) return MYAGENTS_SPEECH_STATUS_MODEL_ERROR;
    auto created = std::make_unique<MyAgentsSpeechDiarizer>();
    created->diarizer = diarizer;
    *out = created.release();
    return MYAGENTS_SPEECH_STATUS_OK;
  } catch (...) {
    if (diarizer != nullptr) SherpaOnnxDestroyOfflineSpeakerDiarization(diarizer);
    return MYAGENTS_SPEECH_STATUS_MODEL_ERROR;
  }
}

void DestroyDiarizer(MyAgentsSpeechDiarizer *diarizer) {
  if (diarizer == nullptr) return;
  if (diarizer->diarizer != nullptr) {
    SherpaOnnxDestroyOfflineSpeakerDiarization(diarizer->diarizer);
  }
  delete diarizer;
}

struct RawEvidenceContext {
  MyAgentsSpeechDiarizationResult *result;
  MyAgentsSpeechEmbeddingStartedCallback started;
  void *user_data;
  uint32_t sample_count;
  MyAgentsSpeechStatus status = MYAGENTS_SPEECH_STATUS_OK;
};

int32_t RawEmbeddingProgress(int32_t completed, int32_t, void *arg) {
  auto &context = *static_cast<RawEvidenceContext *>(arg);
  if (completed == 0 && context.started != nullptr) context.started(context.user_data);
  return 0;
}

// Never let allocation/validation exceptions cross the callback ABI.
int32_t CopyRawEvidence(const SherpaOnnxRawSpeakerEvidence *view, void *arg) {
  auto &context = *static_cast<RawEvidenceContext *>(arg);
  auto &result = *context.result;
  try {
    if (view == nullptr || view->struct_size != sizeof(*view) ||
        view->slot >= 3 || view->chunk_start < 0 ||
        view->chunk_end <= view->chunk_start ||
        static_cast<uint32_t>(view->chunk_end) > context.sample_count ||
        view->embedding_status > 3 || view->activity_count == 0 ||
        view->activity == nullptr ||
        (view->clean_count > 0 && view->clean == nullptr) ||
        ((view->embedding_status == 0) !=
         (view->embedding_dimension == MYAGENTS_SPEECH_EMBEDDING_DIMENSION)) ||
        (view->embedding_status != 0 && view->embedding_dimension != 0) ||
        (view->embedding_dimension > 0 && view->embedding == nullptr)) {
      context.status = MYAGENTS_SPEECH_STATUS_INFERENCE_ERROR;
      return 1;
    }
    if (result.speakers.size() >= MYAGENTS_SPEECH_MAX_RAW_OBSERVATIONS ||
        view->activity_count > MYAGENTS_SPEECH_MAX_LOCAL_SEGMENTS - result.segments.size() ||
        view->clean_count > MYAGENTS_SPEECH_MAX_LOCAL_SEGMENTS - result.clean_segments.size()) {
      context.status = MYAGENTS_SPEECH_STATUS_RESOURCE_LIMIT;
      return 1;
    }
    const uint32_t id = static_cast<uint32_t>(result.speakers.size());
    auto copy_intervals = [&](const SherpaOnnxRawSpeechInterval *intervals,
                              uint32_t count,
                              std::vector<MyAgentsSpeechLocalSegment> &out) {
      uint32_t covered = 0;
      int32_t previous_end = view->chunk_start;
      for (uint32_t i = 0; i < count; ++i) {
        const auto &interval = intervals[i];
        if (interval.start < previous_end || interval.end <= interval.start ||
            interval.end > view->chunk_end) return std::make_pair(false, 0u);
        covered += static_cast<uint32_t>(interval.end - interval.start);
        out.push_back({static_cast<uint64_t>(interval.start),
                       static_cast<uint64_t>(interval.end), id});
        previous_end = interval.end;
      }
      return std::make_pair(true, covered);
    };
    const auto activity = copy_intervals(view->activity, view->activity_count, result.segments);
    const auto clean = copy_intervals(view->clean, view->clean_count, result.clean_segments);
    if (!activity.first || !clean.first || clean.second != view->clean_samples) {
      context.status = MYAGENTS_SPEECH_STATUS_INFERENCE_ERROR;
      return 1;
    }
    uint32_t offset = UINT32_MAX;
    if (view->embedding_status == 0) {
      double norm = 0;
      for (uint32_t i = 0; i < view->embedding_dimension; ++i) {
        if (!std::isfinite(view->embedding[i])) {
          context.status = MYAGENTS_SPEECH_STATUS_INFERENCE_ERROR;
          return 1;
        }
        norm += static_cast<double>(view->embedding[i]) * view->embedding[i];
      }
      if (norm <= std::numeric_limits<double>::epsilon()) {
        context.status = MYAGENTS_SPEECH_STATUS_INFERENCE_ERROR;
        return 1;
      }
      offset = static_cast<uint32_t>(result.embeddings.size());
      result.embeddings.insert(result.embeddings.end(), view->embedding,
                               view->embedding + view->embedding_dimension);
    }
    result.speakers.push_back({id, view->chunk_index, view->slot,
        static_cast<uint32_t>(view->chunk_start), static_cast<uint32_t>(view->chunk_end),
        view->clean_samples, view->embedding_status, offset});
    return 0;
  } catch (const std::bad_alloc &) {
    context.status = MYAGENTS_SPEECH_STATUS_RESOURCE_LIMIT;
  } catch (...) {
    context.status = MYAGENTS_SPEECH_STATUS_INFERENCE_ERROR;
  }
  return 1;
}

MyAgentsSpeechStatus DiarizeWindow(
    MyAgentsSpeechDiarizer *diarizer, const float *samples, uint32_t sample_count,
    const MyAgentsSpeechInterval *excluded, uint32_t excluded_count,
    MyAgentsSpeechEmbeddingStartedCallback embedding_started, void *user_data,
    MyAgentsSpeechDiarizationResult **out) {
  if (out == nullptr) return MYAGENTS_SPEECH_STATUS_INVALID_ARGUMENT;
  *out = nullptr;
  if (diarizer == nullptr || diarizer->diarizer == nullptr ||
      !ValidSamples(samples, sample_count, MYAGENTS_SPEECH_MAX_DIARIZATION_SAMPLES)) {
    return MYAGENTS_SPEECH_STATUS_INVALID_ARGUMENT;
  }
  try {
    if (excluded_count > 2048 || (excluded_count > 0 && excluded == nullptr)) return MYAGENTS_SPEECH_STATUS_INVALID_ARGUMENT;
    std::vector<SherpaOnnxRawSpeechInterval> mask;
    uint64_t previous_end = 0;
    for (uint32_t i = 0; i < excluded_count; ++i) {
      if (excluded[i].start_sample < previous_end || excluded[i].start_sample >= excluded[i].end_sample || excluded[i].end_sample > sample_count) return MYAGENTS_SPEECH_STATUS_INVALID_ARGUMENT;
      mask.push_back({static_cast<int32_t>(excluded[i].start_sample), static_cast<int32_t>(excluded[i].end_sample)});
      previous_end = excluded[i].end_sample;
    }
    auto result = std::make_unique<MyAgentsSpeechDiarizationResult>();
    // Fixed reserve prevents reallocation leaving abandoned voice vectors.
    result->embeddings.reserve(MYAGENTS_SPEECH_MAX_RAW_OBSERVATIONS *
                               MYAGENTS_SPEECH_EMBEDDING_DIMENSION);
    RawEvidenceContext context{result.get(), embedding_started, user_data, sample_count};
    const auto status = SherpaOnnxOfflineSpeakerDiarizationProcessRawV1(
        diarizer->diarizer, samples, static_cast<int32_t>(sample_count), mask.data(), static_cast<uint32_t>(mask.size()),
        RawEmbeddingProgress, CopyRawEvidence, &context);
    if (context.status != MYAGENTS_SPEECH_STATUS_OK) return context.status;
    if (status == 3) return MYAGENTS_SPEECH_STATUS_RESOURCE_LIMIT;
    if (status != 0) return MYAGENTS_SPEECH_STATUS_INFERENCE_ERROR;
    *out = result.release();
    return MYAGENTS_SPEECH_STATUS_OK;
  } catch (const std::bad_alloc &) {
    return MYAGENTS_SPEECH_STATUS_RESOURCE_LIMIT;
  } catch (...) {
    return MYAGENTS_SPEECH_STATUS_INFERENCE_ERROR;
  }
}

MyAgentsSpeechStatus CopyDiarizationResult(
    const MyAgentsSpeechDiarizationResult *result, MyAgentsSpeechDiarizationOutput *out) {
  if (result == nullptr || out == nullptr || out->struct_size != sizeof(*out)) {
    return MYAGENTS_SPEECH_STATUS_INVALID_ARGUMENT;
  }
  out->speaker_count = static_cast<uint32_t>(result->speakers.size());
  out->segment_count = static_cast<uint32_t>(result->segments.size());
  out->clean_segment_count = static_cast<uint32_t>(result->clean_segments.size());
  out->embedding_count = static_cast<uint32_t>(result->embeddings.size());
  if ((out->speaker_count > 0 && (out->speakers == nullptr || out->speaker_capacity < out->speaker_count)) ||
      (out->segment_count > 0 && (out->segments == nullptr || out->segment_capacity < out->segment_count)) ||
      (out->clean_segment_count > 0 && (out->clean_segments == nullptr || out->clean_segment_capacity < out->clean_segment_count)) ||
      (out->embedding_count > 0 && (out->embeddings == nullptr || out->embedding_capacity < out->embedding_count))) {
    return MYAGENTS_SPEECH_STATUS_BUFFER_TOO_SMALL;
  }
  if (!result->speakers.empty()) std::copy(result->speakers.begin(), result->speakers.end(), out->speakers);
  if (!result->segments.empty()) std::copy(result->segments.begin(), result->segments.end(), out->segments);
  if (!result->clean_segments.empty()) std::copy(result->clean_segments.begin(), result->clean_segments.end(), out->clean_segments);
  if (!result->embeddings.empty()) std::copy(result->embeddings.begin(), result->embeddings.end(), out->embeddings);
  return MYAGENTS_SPEECH_STATUS_OK;
}

void DestroyDiarizationResult(MyAgentsSpeechDiarizationResult *result) { delete result; }

MyAgentsSpeechStatus ClusterDistances(
    const double *distances, uint32_t distance_count, uint32_t node_count,
    double distance_threshold, uint32_t *labels, uint32_t label_capacity,
    uint32_t *speaker_count) {
  if (node_count > MYAGENTS_SPEECH_MAX_CLUSTER_NODES ||
      distance_count != static_cast<uint64_t>(node_count) * (node_count == 0 ? 0 : node_count - 1) / 2 ||
      !std::isfinite(distance_threshold) || distance_threshold <= 0 || distance_threshold >= 2 ||
      (node_count > 0 && (labels == nullptr || label_capacity < node_count)) ||
      (distance_count > 0 && distances == nullptr) || speaker_count == nullptr) {
    return MYAGENTS_SPEECH_STATUS_INVALID_ARGUMENT;
  }
  for (uint32_t i = 0; i < distance_count; ++i) {
    // 3 is the finite cannot-link barrier; ordinary cosine distances are <= 2.
    if (!std::isfinite(distances[i]) || distances[i] < 0 || distances[i] > 3) {
      return MYAGENTS_SPEECH_STATUS_INVALID_ARGUMENT;
    }
  }
  try {
    if (node_count <= 1) {
      if (node_count == 1) labels[0] = 0;
      *speaker_count = node_count;
      return MYAGENTS_SPEECH_STATUS_OK;
    }
    std::vector<double> mutable_distances(distances, distances + distance_count);
    std::vector<int32_t> merge(2 * (node_count - 1));
    std::vector<double> height(node_count - 1);
    std::vector<int32_t> native_labels(node_count);
    if (fastclustercpp::hclust_fast(static_cast<int32_t>(node_count), mutable_distances.data(),
        fastclustercpp::HCLUST_METHOD_COMPLETE, merge.data(), height.data()) != 0) {
      return MYAGENTS_SPEECH_STATUS_INFERENCE_ERROR;
    }
    fastclustercpp::cutree_cdist(static_cast<int32_t>(node_count), merge.data(), height.data(),
        distance_threshold, native_labels.data());
    uint32_t maximum_label = 0;
    for (uint32_t row = 0; row != node_count; ++row) {
      if (native_labels[row] < 0 || native_labels[row] >= static_cast<int32_t>(node_count)) {
        return MYAGENTS_SPEECH_STATUS_INFERENCE_ERROR;
      }
      labels[row] = static_cast<uint32_t>(native_labels[row]);
      maximum_label = std::max(maximum_label, labels[row]);
    }
    *speaker_count = maximum_label + 1;
    return MYAGENTS_SPEECH_STATUS_OK;
  } catch (const std::bad_alloc &) {
    return MYAGENTS_SPEECH_STATUS_RESOURCE_LIMIT;
  } catch (...) {
    return MYAGENTS_SPEECH_STATUS_INFERENCE_ERROR;
  }
}

const MyAgentsSpeechAdapterApiV2 kApi = {
    sizeof(MyAgentsSpeechAdapterApiV2),
    MYAGENTS_SPEECH_ADAPTER_ABI_VERSION,
    GetBuildInfo,
    CreateAsr,
    DestroyAsr,
    Transcribe,
    CreateVad,
    DestroyVad,
    VadAccept,
    VadFlush,
    VadPop,
    VadReset,
    CreateDiarizer,
    DestroyDiarizer,
    DiarizeWindow,
    CopyDiarizationResult,
    DestroyDiarizationResult,
    ClusterDistances,
};

}  // namespace

extern "C" MYAGENTS_SPEECH_EXPORT const MyAgentsSpeechAdapterApiV2 *
myagents_speech_adapter_get_api(uint32_t requested_abi_version) {
  return requested_abi_version == MYAGENTS_SPEECH_ADAPTER_ABI_VERSION ? &kApi
                                                                      : nullptr;
}
