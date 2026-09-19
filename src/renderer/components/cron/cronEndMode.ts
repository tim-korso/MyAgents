// Pure end-condition mode derivation for the cron settings modal.
// Kept as a leaf module (no React) so it's unit-testable and so the modal's
// init logic and any future consumer share one source of truth.

import type { CronEndConditions } from '@/types/cronTask';

export type EndMode = 'conditional' | 'forever';

/**
 * Which end-condition mode an existing/preset config opens in.
 *
 * `aiCanExit` is intentionally NOT a 条件停止 (conditional) trigger: the
 * "允许 AI 自主结束任务" checkbox is shown in BOTH 永久运行 and 条件停止 modes,
 * and a config whose only end-condition is `aiCanExit` means
 * "永久运行，但允许 AI 自主结束" — i.e. 'forever'. This mirrors the modal's
 * confirm path, whose forever branch emits exactly `{ aiCanExit }`; counting it
 * here would mislabel such a task as 条件停止 on re-open (a round-trip
 * asymmetry) and would stop the `/loop` preset from opening in 永久运行.
 *
 * Only a real stop condition — a deadline or a max-execution count — implies
 * 条件停止.
 */
export function deriveInitialEndMode(ec: CronEndConditions | undefined | null): EndMode {
  return ec && (ec.deadline || ec.maxExecutions != null) ? 'conditional' : 'forever';
}
