#pragma once

#include <algorithm>
#include <cstdint>

// The model's max_speech_duration only encourages an endpoint. Enforce the
// application's bound while feeding input, before an unbounded segment can
// accumulate. Silence and natural endpoints restart this counter; they must
// not cause a new utterance to be cut at a periodic wall-clock boundary.
class BoundedVadInput {
 public:
  void Reset() { active_samples_ = 0; }

  template <typename Accept, typename Detected, typename Flush>
  void Feed(const float* samples, uint32_t count, uint32_t window_samples,
            uint32_t max_active_samples, Accept accept, Detected detected,
            Flush flush) {
    for (uint32_t offset = 0; offset < count;) {
      const uint32_t take = std::min(window_samples, count - offset);
      accept(samples + offset, take);
      offset += take;
      if (!detected()) {
        Reset();
        continue;
      }
      active_samples_ += take;
      if (active_samples_ >= max_active_samples) {
        flush();
        Reset();
      }
    }
  }

 private:
  uint32_t active_samples_ = 0;
};
