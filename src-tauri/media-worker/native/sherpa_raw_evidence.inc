  // MyAgents source extension. Unlike Process(), every duration follows the
  // same raw activity/embedding path. No final-turn clustering, top-k identity
  // reconstruction, short-input shortcut or fatal not-ready path is used.
  RawDiarizationEvidence ProcessRaw(
      const float *audio, int32_t n,
      OfflineSpeakerDiarizationProgressCallback callback = nullptr,
      void *callback_arg = nullptr,
      const std::vector<RawSpeechInterval> &excluded = {}) const override {
    const auto &meta = segmentation_model_.GetModelMetaData();
    if (audio == nullptr || n <= 0 || n > 300 * 16000 ||
        meta.sample_rate != 16000 || meta.window_size <= 0 ||
        meta.window_shift <= 0 || meta.num_speakers <= 0 ||
        meta.num_speakers > 3 || embedding_extractor_.Dim() != 512) {
      throw std::invalid_argument("Invalid raw diarization input or model");
    }
    const int32_t expected_chunks = n <= meta.window_size ? 1 :
        1 + (n - meta.window_size + meta.window_shift - 1) / meta.window_shift;
    if (expected_chunks * meta.num_speakers > 192) {
      throw std::length_error("Raw diarization observation budget exceeded");
    }
    for (int32_t i = 0; i < n; ++i) {
      if (!std::isfinite(audio[i])) {
        throw std::invalid_argument("Non-finite raw diarization input");
      }
    }
    auto scores = RunSpeakerSegmentationModel(audio, n);
    if (scores.size() != static_cast<size_t>(expected_chunks)) {
      throw std::runtime_error("Unexpected raw segmentation chunk count");
    }
    std::vector<Matrix2DInt32> labels;
    labels.reserve(scores.size());
    for (const auto &score : scores) {
      if (score.rows() <= 0 || score.rows() > 4096 ||
          score.cols() != powerset_mapping_.rows() || !score.allFinite()) {
        throw std::runtime_error("Invalid raw segmentation output");
      }
      labels.push_back(ToMultiLabel(score));
    }
    scores.clear();

    RawDiarizationEvidence result;
    for (int32_t chunk = 0; chunk < expected_chunks; ++chunk) {
      const auto &label = labels[chunk];
      const int32_t start = chunk * meta.window_shift;
      const int32_t end = std::min(start + meta.window_size, n);
      for (int32_t slot = 0; slot < meta.num_speakers; ++slot) {
        RawSpeakerEvidence evidence;
        evidence.chunk_index = chunk;
        evidence.slot = slot;
        evidence.chunk_start = start;
        evidence.chunk_end = end;
        evidence.activity = RawActivityIntervals(
            label.rows(), meta.receptive_field_size, meta.receptive_field_shift,
            start, end, [&](int32_t frame) { return label(frame, slot) != 0; });
        evidence.activity = ExcludeRawIntervals(evidence.activity, excluded);
        if (evidence.activity.empty()) continue;
        evidence.clean = RawActivityIntervals(
            label.rows(), meta.receptive_field_size, meta.receptive_field_shift,
            start, end, [&](int32_t frame) {
              return label(frame, slot) != 0 && label.row(frame).sum() == 1;
            });
        evidence.clean = ExcludeRawIntervals(evidence.clean, excluded);
        for (const auto &interval : evidence.clean) {
          evidence.clean_samples += interval.end - interval.start;
        }
        result.push_back(std::move(evidence));
      }
    }
    if (callback) callback(0, result.size(), callback_arg);
    for (size_t index = 0; index < result.size(); ++index) {
      auto &evidence = result[index];
      if (evidence.clean_samples != 0) {
        auto stream = embedding_extractor_.CreateStream();
        if (!stream) throw std::runtime_error("Raw embedding stream unavailable");
        for (const auto &interval : evidence.clean) {
          stream->AcceptWaveform(meta.sample_rate, audio + interval.start,
                                 interval.end - interval.start);
        }
        stream->InputFinished();
        if (!embedding_extractor_.IsReady(stream.get())) {
          evidence.status = RawEmbeddingStatus::kNotReady;
        } else {
          evidence.embedding = embedding_extractor_.Compute(stream.get());
          if (evidence.embedding.size() != 512) {
            throw std::runtime_error("Invalid raw embedding dimension");
          }
          double norm = 0;
          for (float value : evidence.embedding) norm += static_cast<double>(value) * value;
          const bool valid = std::isfinite(norm) && norm > 1e-12 &&
              std::all_of(evidence.embedding.begin(), evidence.embedding.end(),
                          [](float value) { return std::isfinite(value); });
          evidence.status = valid ? RawEmbeddingStatus::kAvailable : RawEmbeddingStatus::kInvalidVector;
          if (!valid) {
            for (auto &sample : evidence.embedding) {
              volatile float *value = &sample;
              *value = 0;
            }
            evidence.embedding.clear();
          }
        }
      }
      if (callback) callback(index + 1, result.size(), callback_arg);
    }
    return result;
  }
