#include "myagents_speech_adapter.h"
#include <cassert>
#include <cmath>
#include <limits>
#include <vector>

int main() {
  assert(myagents_speech_adapter_get_api(1) == nullptr);
  const auto *api = myagents_speech_adapter_get_api(2);
  assert(api != nullptr && api->struct_size == sizeof(*api));
  auto cluster = [&](std::vector<double> distances, uint32_t nodes, double threshold) {
    std::vector<uint32_t> labels(nodes);
    uint32_t speakers = UINT32_MAX;
    const auto original = distances;
    assert(api->cluster_distances(distances.data(), static_cast<uint32_t>(distances.size()), nodes,
        threshold, labels.data(), nodes, &speakers) == MYAGENTS_SPEECH_STATUS_OK);
    assert(distances == original);  // hclust cannot mutate caller-owned evidence.
    assert(speakers <= nodes && (nodes == 0) == (speakers == 0));
    return labels;
  };
  assert(cluster({}, 0, 0.5).empty());
  assert(cluster({}, 1, 0.5) == std::vector<uint32_t>{0});
  assert((cluster({0.49}, 2, 0.5) == std::vector<uint32_t>{0, 0}));
  assert((cluster({0.5}, 2, 0.5) == std::vector<uint32_t>{0, 1}));
  // The same strict boundary also applies with three nodes.
  const auto boundary = cluster({0.5, 1.0, 1.0}, 3, 0.5);
  assert(boundary[0] != boundary[1]);
  const auto bridge = cluster({3.0, 0.1, 0.2}, 3, 0.5);
  assert(bridge[0] != bridge[1]);
  assert(bridge[0] == bridge[2] || bridge[1] == bridge[2]);
  uint32_t labels[3]{};
  uint32_t count = 0;
  for (double invalid : {std::numeric_limits<double>::quiet_NaN(),
                         std::numeric_limits<double>::infinity(), -0.1, 3.1}) {
    assert(api->cluster_distances(&invalid, 1, 2, 0.5, labels, 3, &count) == MYAGENTS_SPEECH_STATUS_INVALID_ARGUMENT);
  }
  const double distance = 0.2;
  assert(api->cluster_distances(&distance, 1, 3, 0.5, labels, 3, &count) == MYAGENTS_SPEECH_STATUS_INVALID_ARGUMENT);
  assert(api->cluster_distances(&distance, 1, 2049, 0.5, labels, 3, &count) == MYAGENTS_SPEECH_STATUS_INVALID_ARGUMENT);
}
