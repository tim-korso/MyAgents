#include "sherpa_raw_evidence.h"

#include <array>
#include <cassert>
#include <stdexcept>

int main() {
  using sherpa_onnx::RawActivityIntervals;
  // The padded ten-second model output cannot manufacture a ten-second turn
  // for a 500 ms recording, or stretch its last-frame activity into that audio.
  const auto short_turn = RawActivityIntervals(589, 991, 270, 0, 8000,
                                               [](int) { return true; });
  assert(short_turn.size() == 1);
  assert(short_turn[0].start == 0 && short_turn[0].end == 8000);
  const auto padded_only = RawActivityIntervals(589, 991, 270, 0, 8000,
                                                [](int frame) { return frame > 100; });
  assert(padded_only.empty());

  // Half-open frame boundaries preserve a speaker transition without creating
  // simultaneous activity (and therefore a false cannot-link constraint).
  const auto left = RawActivityIntervals(8, 991, 270, 1000, 4000,
                                         [](int frame) { return frame < 3; });
  const auto right = RawActivityIntervals(8, 991, 270, 1000, 4000,
                                          [](int frame) { return frame >= 3; });
  assert(left.size() == 1 && right.size() == 1);
  assert(left[0].end == right[0].start);
  assert(left[0].start == 1000 && right[0].end == 4000);

  // Both speakers remain active during overlap. Neither gets exclusive PCM
  // merely because the embedding extractor needs some input.
  const std::array<std::array<int, 2>, 8> labels = {{{0, 0}, {0, 0}, {1, 1},
      {1, 1}, {1, 1}, {0, 0}, {0, 0}, {0, 0}}};
  for (int slot = 0; slot < 2; ++slot) {
    const auto activity = RawActivityIntervals(8, 991, 270, 0, 3000,
        [&](int frame) { return labels[frame][slot] != 0; });
    const auto clean = RawActivityIntervals(8, 991, 270, 0, 3000,
        [&](int frame) { return labels[frame][slot] != 0 &&
            labels[frame][0] + labels[frame][1] == 1; });
    assert(activity.size() == 1 && clean.empty());
  }
  assert(RawActivityIntervals(8, 991, 270, 0, 3000,
                              [](int) { return false; }).empty());
  // A proven echo mask clips both activity and exclusive embedding input.
  // Keep the near-end intervals on either side; never drop a mixed paragraph.
  const auto masked = sherpa_onnx::ExcludeRawIntervals({{0, 100}, {200, 300}}, {{20, 80}, {250, 400}});
  assert(masked.size() == 3);
  assert(masked[0].start == 0 && masked[0].end == 20);
  assert(masked[1].start == 80 && masked[1].end == 100);
  assert(masked[2].start == 200 && masked[2].end == 250);
  bool invalid = false;
  try {
    RawActivityIntervals(0, 991, 270, 0, 3000, [](int) { return true; });
  } catch (const std::invalid_argument &) {
    invalid = true;
  }
  assert(invalid);
}
