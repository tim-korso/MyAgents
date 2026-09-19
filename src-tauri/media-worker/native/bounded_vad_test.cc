#include "bounded_vad.h"

#include <cassert>
#include <cstdint>
#include <utility>
#include <vector>

// A detector is allowed to keep returning speech forever. This fixture closes
// an utterance only on silence or explicit flush, preserving absolute samples.
struct Detector {
  uint64_t position = 0;
  uint64_t start = 0;
  bool active = false;
  std::vector<std::pair<uint64_t, uint64_t>> segments;
  void Flush() {
    if (active) segments.emplace_back(start, position);
    active = false;
  }
  void Accept(const float* samples, uint32_t count) {
    if (samples[0] == 0.0f) {
      Flush();
    } else if (!active) {
      start = position;
      active = true;
    }
    position += count;
  }
};

int main() {
  constexpr uint32_t limit = 30 * 16000;
  for (uint32_t chunk : {320u, 80000u}) {
    BoundedVadInput input;
    Detector detector;
    auto feed = [&](uint32_t count, float value) {
      std::vector<float> pcm(count, value);
      input.Feed(pcm.data(), count, 512, limit,
                 [&](const float* p, uint32_t n) { detector.Accept(p, n); },
                 [&] { return detector.active; }, [&] { detector.Flush(); });
    };
    uint32_t remaining = 64 * 16000;
    while (remaining > 0) {
      const auto take = std::min(chunk, remaining);
      feed(take, 0.5f);
      remaining -= take;
    }
    detector.Flush();
    input.Reset();
    assert(detector.segments.size() == 3);
    uint64_t end = 0;
    for (auto segment : detector.segments) {
      assert(segment.first == end);
      assert(segment.second - segment.first <= limit + 512);
      end = segment.second;
    }
    assert(end == 64 * 16000);

    // A long silence does not consume the next utterance's budget.
    for (int i = 0; i < 60; ++i) feed(16000, 0.0f);
    feed(1600, 0.5f);
    assert(detector.segments.size() == 3);
    detector.Flush();
    input.Reset();
    assert(detector.segments.back().second - detector.segments.back().first == 1600);

    // Pause/reset starts a fresh budget without carrying a previous near-limit.
    feed(limit - 1000, 0.5f);
    detector.Flush();
    input.Reset();
    const auto previous = detector.segments.size();
    feed(16000, 0.5f);
    assert(detector.segments.size() == previous);
  }
}
