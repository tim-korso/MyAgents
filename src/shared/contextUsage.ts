/**
 * Context 用量归一化 —— 唯一纯函数核心（PRD 0.2.32 §4.2）。
 *
 * 每个 runtime adapter 只负责喂「占用 tokens + runtime 报的窗口（可空）+ model」，
 * 窗口回退、百分比、windowSource 的判定全在这里，一处可单测。
 *
 * 依赖边界（红线）：`src/shared/**` 不得 import sidecar/renderer。窗口注册表查询
 * （`lookupModelContextLength`）通过 `lookupWindow` 注入，保持本文件纯净。
 */
import type { ContextUsage } from './types/context-usage';

/**
 * SDK `MODEL_CONTEXT_WINDOW_DEFAULT`。当 runtime 不报窗口、registry 也查不到时的兜底分母。
 * Builtin session 使用同一个有效窗口，并在其 `BUILTIN_AUTO_COMPACT_PERCENT` 处开始自动压缩。
 */
export const SDK_DEFAULT_CONTEXT_WINDOW = 200_000;

/** Builtin Claude SDK 的自动压缩策略，由子进程 env 与 UI 投影共同消费。 */
export const BUILTIN_AUTO_COMPACT_PERCENT = 90;

/**
 * 绝对压缩阈值表 —— 命中即用固定 tokens 数而非窗口百分比。
 *
 * 为什么需要它：窗口百分比对「窗口远大于模型有效注意力」的模型是错的策略。
 * 1M 窗口的 90% = 900K，但这个量级的上下文里模型已经开始迷失——表现是回答
 * 变浅、对非常规/特殊请求倾向推诿，而不是报错。此时按百分比压缩等于「等到
 * 已经变笨了才压缩」。对这类模型，压缩点该由**有效注意力**决定，不是窗口。
 *
 * 依据：Proma 对 deepseek-v4-flash 的实测结论（窗口保持 1M 不变，压缩阈值定
 * 在 128K），见其 docs/decisions/2026-09-03-flash-128k-auto-compaction.md。
 * 刻意不动窗口注册值——窗口是模型能力与计费展示的真实值。
 */
const ABSOLUTE_COMPACTION_THRESHOLDS: ReadonlyArray<{ pattern: RegExp; tokens: number }> = [
  // flash 系列是长窗口里最容易在超长上下文下失焦的一档（pro 同窗口但更稳）。
  // 匹配 `deepseek-v4-flash` / `deepseek-v4.1-flash` / `...-flash-0731`。
  { pattern: /^deepseek-v4(?:\.\d+)?-flash(?:-|$)/i, tokens: 128_000 },
];

/** 命中绝对阈值表时返回目标 tokens，否则 undefined（表示按百分比走）。 */
export function absoluteAutoCompactThresholdFor(model?: string | null): number | undefined {
  const id = stripModelSuffix(model);
  if (!id) return undefined;
  // Models reach us in two shapes: bare (`deepseek-v4-flash`, what the registry
  // and config.toml use) and provider-qualified (`deepseek/deepseek-v4.1-flash`,
  // what MyAgents' codex runtime passes over RPC). Match on the final path
  // segment so both forms resolve — anchoring at `^` silently missed the
  // qualified form, which is the one the active session actually uses.
  const bare = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id;
  for (const rule of ABSOLUTE_COMPACTION_THRESHOLDS) {
    if (rule.pattern.test(bare)) return rule.tokens;
  }
  return undefined;
}

/**
 * 该模型的有效自动压缩百分比（注入 SDK `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`）。
 *
 * 绝对阈值换算成百分比是为了复用 SDK 既有的「窗口 × 百分比」机制，避免再开
 * 一条并行的注入通道。取 `min(默认百分比, 换算值)`：当窗口本身就小于绝对阈值
 * 时（例如已经注册成 128K 的模型），换个更激进的百分比只会让压缩点超过窗口，
 * 此时默认百分比更保守、应当胜出。
 */
export function builtinAutoCompactPercentFor(
  model: string | undefined | null,
  contextWindow: number,
): number {
  const absolute = absoluteAutoCompactThresholdFor(model);
  if (absolute === undefined) return BUILTIN_AUTO_COMPACT_PERCENT;
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return BUILTIN_AUTO_COMPACT_PERCENT;
  const converted = (absolute / contextWindow) * 100;
  return Math.min(BUILTIN_AUTO_COMPACT_PERCENT, converted);
}

/**
 * 自动压缩触发点（tokens）。运行时注入与 UI 预警线共用本函数，避免
 * 「UI 说到 900K 才压缩、实际 128K 就压了」这种两处不一致。
 *
 * `model` 省略时退回纯百分比策略——既有调用点不受影响。
 */
export function computeBuiltinAutoCompactThreshold(contextWindow: number, model?: string | null): number {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) return 0;
  return Math.round(contextWindow * builtinAutoCompactPercentFor(model, contextWindow) / 100);
}

/**
 * 去掉模型 id 的能力后缀，返回裸 id。registry 的 key 是裸 id，查窗口前必须 strip——否则
 * 1M 窗口模型（`claude-opus-4-6[1m]` 等）查不到、错误回落 200K。与 SDK
 * `normalizeModelStringForAPI` / `applyContextWindowSuffix` 的 `[1m]` 语义对齐。
 *
 * 处理两种后缀形态外加首尾空白（#338）：
 *  - 规范的方括号形 `[1m]`（applyContextWindowSuffix 产出、SDK `has1mContext` 认的形式）；
 *  - 用户手填的畸形空格形 ` 1m`（如 `claude-sonnet-4-6 1m`）——issue #338 里用户照着
 *    `mimo-v2.5-pro[1m]` 文档却敲成空格，registry 永远查不到、且 ` 1m` 还会泄到 wire。
 * `[1m]` 是 SDK-ingress 的装饰（applyContextWindowSuffix 末端按 registry 重新贴），
 * **绝不**作为 registry key 或 lookup query 的一部分。
 * 注意 `\s+1m` 要求 `1m` 前有空白，故连字符形（`foo-1m`）这类合法 id 不会被误删。
 */
export function stripModelSuffix(model: string | undefined | null): string | undefined {
  if (!model) return undefined;
  const bare = model.replace(/(?:\[1m\]|\s+1m)\s*$/i, '').trim();
  return bare.length > 0 ? bare : undefined;
}

function finitePositive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * 允许 0 的有限数校验。
 *
 * 与 `finitePositive` 分开是因为缓存两侧的 0 都是真实读数（本轮完全没命中 /
 * 完全命中），把它们当「缺失」会把已知的 0% 显示成未知。
 */
function finiteNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export interface ComputeContextUsageInput {
  /** 当前占用 token（最近一次调用 input[+cache，按系]）。 */
  occupiedTokens: number;
  /** runtime 权威窗口（SDK `ModelUsage.contextWindow` / Codex `modelContextWindow`）；不报传 null。 */
  runtimeWindow: number | null;
  source: ContextUsage['source'];
  model?: string;
  /** 注入 `lookupModelContextLength`（返回 number | undefined）。保持 shared 纯净。 */
  lookupWindow: (model?: string) => number | null | undefined;
  /**
   * 最近一次调用的缓存命中明细，可选。
   *
   * 两个字段都缺省时快照里不带命中率——UI 必须能区分「命中 0%」与「runtime
   * 没报」，后者显示 0% 会让人误以为缓存完全失效。
   */
  cacheReadTokens?: number;
  freshInputTokens?: number;
}

/**
 * 归一化为 `ContextUsage`。窗口优先级：runtime 自报 → registry 查到 → 200K 兜底。
 * 占用为负/NaN 视为 0；usedPercent 封顶 100（压缩前可能 >100% 的瞬时高估不外溢）。
 */
export function computeContextUsage(input: ComputeContextUsageInput): ContextUsage {
  const { occupiedTokens, runtimeWindow, source, model, lookupWindow } = input;
  const cacheRead = finiteNonNegative(input.cacheReadTokens);
  const fresh = finiteNonNegative(input.freshInputTokens);
  // 只在两侧都拿到数字时才记命中率。缓存口径各有差异（有的 runtime 把命中
  // 算进 input_tokens，有的单独报），缺任一侧就算不出可靠分母，宁可不报。
  const hasCache = cacheRead !== null && fresh !== null;

  const occupied = finitePositive(occupiedTokens) ? Math.round(occupiedTokens) : 0;

  let contextWindow: number;
  let windowSource: ContextUsage['windowSource'];

  const runtime = finitePositive(runtimeWindow);
  if (runtime !== null) {
    contextWindow = runtime;
    windowSource = 'runtime';
  } else {
    const looked = finitePositive(lookupWindow(stripModelSuffix(model)));
    if (looked !== null) {
      contextWindow = looked;
      windowSource = 'registry';
    } else {
      contextWindow = SDK_DEFAULT_CONTEXT_WINDOW;
      windowSource = 'default';
    }
  }

  const usedPercent = Math.min(100, (occupied / contextWindow) * 100);

  return {
    contextTokens: occupied,
    contextWindow,
    usedPercent,
    source,
    windowSource,
    model: model || undefined,
    ...(hasCache
      ? { cacheReadTokens: Math.round(cacheRead), freshInputTokens: Math.round(fresh) }
      : {}),
  };
}

/**
 * Prompt cache 命中率，0-100。命中或不命中都有数据时才有意义。
 *
 * 返回 undefined 表示「runtime 没上报」，调用方必须与「0%」区分对待：把未知
 * 画成 0% 会让人以为缓存完全失效，从而去排查一个并不存在的问题。
 *
 * 分母是 `命中 + 新鲜输入`——即这次请求实际送入的 prompt 总量。刻意不把
 * `contextTokens` 当分母：后者是窗口占用（含历史累积），与「本轮 prompt
 * 有多少被缓存复用」不是同一个量。
 */
export function contextCacheHitRate(usage: {
  cacheReadTokens?: number;
  freshInputTokens?: number;
}): number | undefined {
  // Non-negative, not positive: 0 is a meaningful reading on both sides
  // ("nothing was reused" / "everything was reused"). `finitePositive` would
  // reject both and report "unknown", which is exactly the confusion this
  // helper exists to avoid.
  const hit = finiteNonNegative(usage.cacheReadTokens);
  const fresh = finiteNonNegative(usage.freshInputTokens);
  if (hit === null || fresh === null) return undefined;
  const prompt = hit + fresh;
  if (prompt <= 0) return undefined;
  return (hit / prompt) * 100;
}
