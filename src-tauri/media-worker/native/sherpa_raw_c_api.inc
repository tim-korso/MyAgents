int32_t SherpaOnnxOfflineSpeakerDiarizationProcessRawV1(
    const SherpaOnnxOfflineSpeakerDiarization *sd, const float *samples,
    int32_t n, const SherpaOnnxRawSpeechInterval *excluded, uint32_t excluded_count,
    SherpaOnnxOfflineSpeakerDiarizationProgressCallback progress,
    SherpaOnnxRawEvidenceVisitor visitor, void *arg) {
  if (sd == nullptr || samples == nullptr || n <= 0 || visitor == nullptr) return 1;
  try {
    if (excluded_count > 2048 || (excluded_count > 0 && excluded == nullptr)) return 1;
    std::vector<sherpa_onnx::RawSpeechInterval> mask;
    int32_t previous_end = 0;
    for (uint32_t i = 0; i < excluded_count; ++i) {
      if (excluded[i].start < previous_end || excluded[i].start >= excluded[i].end || excluded[i].end > n) return 1;
      mask.push_back({excluded[i].start, excluded[i].end});
      previous_end = excluded[i].end;
    }
    auto evidence = sd->impl->ProcessRaw(samples, n, progress, arg, mask);
    for (const auto &slot : evidence) {
      std::vector<SherpaOnnxRawSpeechInterval> activity;
      std::vector<SherpaOnnxRawSpeechInterval> clean;
      activity.reserve(slot.activity.size());
      clean.reserve(slot.clean.size());
      for (const auto &interval : slot.activity) activity.push_back({interval.start, interval.end});
      for (const auto &interval : slot.clean) clean.push_back({interval.start, interval.end});
      SherpaOnnxRawSpeakerEvidence view{};
      view.struct_size = sizeof(view);
      view.chunk_index = slot.chunk_index;
      view.slot = slot.slot;
      view.chunk_start = slot.chunk_start;
      view.chunk_end = slot.chunk_end;
      view.clean_samples = slot.clean_samples;
      view.embedding_status = static_cast<uint32_t>(slot.status);
      view.embedding = slot.embedding.data();
      view.embedding_dimension = static_cast<uint32_t>(slot.embedding.size());
      view.activity = activity.data();
      view.activity_count = static_cast<uint32_t>(activity.size());
      view.clean = clean.data();
      view.clean_count = static_cast<uint32_t>(clean.size());
      if (visitor(&view, arg) != 0) return 4;
    }
    return 0;
  } catch (const std::invalid_argument &) {
    return 1;
  } catch (const std::length_error &) {
    return 3;
  } catch (const std::bad_alloc &) {
    return 3;
  } catch (...) {
    return 2;
  }
}
