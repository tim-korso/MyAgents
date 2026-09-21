/**
 * Detects a model repeating the same tool call and, when it does, supplies the
 * corrective instruction that breaks the cycle.
 *
 * Why this is needed here rather than left to the model: a repeating loop is
 * self-sustaining. The model re-issues the call, sees the same result it
 * already saw, and concludes nothing new — so it tries again. From the UI this
 * is indistinguishable from a hang: the turn stays "running", tokens keep
 * being spent, and no error is ever raised. Interrupting only stops the
 * bleeding; the fix is to break the pattern while the turn is still alive.
 *
 * Pure and stateful-by-argument so it can be tested without a session: the
 * caller owns the history array and asks what the next call means.
 */

export interface ToolCallSignature {
  name: string;
  /** Stable serialization of the arguments; ordering must be normalized first. */
  args: string;
}

export interface ToolLoopVerdict {
  /** True when this call continues an unproductive repetition. */
  looping: boolean;
  /** How many consecutive identical calls have now been observed, including this one. */
  repeatCount: number;
  /** Instruction to hand back to the model; only set when `looping`. */
  correction?: string;
  /**
   * True when the model has ignored the correction and kept repeating.
   *
   * The caller should stop the turn rather than keep denying: at this point the
   * model is not converging, and an endless stream of denials is just a slower
   * hang. Giving up loudly is better than burning tokens silently.
   */
  exhausted: boolean;
}

/**
 * Consecutive identical calls required before intervening.
 *
 * Four, not two: some tools legitimately run twice in a row (read a file, edit
 * it, read it again to confirm; poll a build). Two would fire constantly and
 * make the correction noise the model learns to ignore.
 */
export const LOOP_REPEAT_THRESHOLD = 4;

/** Cap on retained history; only the tail can be part of a current run. */
export const LOOP_HISTORY_LIMIT = 12;

/**
 * Repeats tolerated after the correction before the turn is declared stuck.
 *
 * One correction is usually enough. The allowance exists because a model that
 * acknowledges the correction and retries once is still making progress; one
 * that keeps going past this is not.
 */
export const LOOP_ABORT_THRESHOLD = LOOP_REPEAT_THRESHOLD + 3;

/**
 * Normalize tool arguments for comparison.
 *
 * Key order is not semantic, and JSON.stringify preserves insertion order — so
 * two identical calls can serialize differently (`{"a":1,"b":2}` vs
 * `{"b":2,"a":1}`) and a naive string compare would miss the loop entirely.
 * Sorts recursively and drops `undefined` so the signature reflects meaning.
 */
export function normalizeToolArgs(input: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        const v = (value as Record<string, unknown>)[key];
        if (v === undefined) continue;
        out[key] = canonical(v);
      }
      return out;
    }
    return value;
  };
  try {
    return JSON.stringify(canonical(input)) ?? '';
  } catch {
    // Circular or otherwise unserializable: fall back to a type marker so the
    // call still participates in the run rather than throwing inside a hook.
    return '[unserializable]';
  }
}

/**
 * Record `call` against `history` and decide whether the model is looping.
 *
 * `history` is mutated (tail-trimmed) so callers can keep one array per turn
 * without bookkeeping. Trimming to `LOOP_HISTORY_LIMIT` bounds memory and, more
 * importantly, keeps the run definition local: a repeated call from an hour ago
 * is not part of the current cycle.
 */
export function detectToolLoop(
  history: ToolCallSignature[],
  call: ToolCallSignature,
  threshold = LOOP_REPEAT_THRESHOLD,
): ToolLoopVerdict {
  history.push(call);
  if (history.length > LOOP_HISTORY_LIMIT) history.splice(0, history.length - LOOP_HISTORY_LIMIT);

  let repeatCount = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];
    if (entry && entry.name === call.name && entry.args === call.args) repeatCount += 1;
    else break;
  }

  if (repeatCount < threshold) return { looping: false, repeatCount, exhausted: false };

  return {
    looping: true,
    repeatCount,
    correction: buildLoopCorrection(call.name, repeatCount),
    exhausted: repeatCount >= LOOP_ABORT_THRESHOLD,
  };
}

/**
 * The instruction handed back when a loop is detected.
 *
 * Deliberately prescriptive about the *next action* rather than scolding about
 * repetition: the model already believes the call is productive, so telling it
 * "you are repeating yourself" invites a rephrase of the same intent. Naming
 * concrete alternatives (read the current state, change the approach, report a
 * blocker) gives it somewhere else to go.
 */
function buildLoopCorrection(toolName: string, repeatCount: number): string {
  return [
    `检测到重复调用：同一个 ${toolName} 调用已连续执行 ${repeatCount} 次，且结果没有变化。`,
    '请不要再用相同参数调用它。改为：',
    '1) 重新读取当前状态（文件/命令输出）确认实际情况；',
    '2) 换一种方法或换一个工具来推进；',
    '3) 如果确实被阻塞，直接说明阻塞点和你需要的输入，然后结束本轮。',
  ].join('\n');
}
