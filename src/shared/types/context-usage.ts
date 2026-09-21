/**
 * 归一化的「当前 context 窗口用量」快照（PRD 0.2.32）。
 *
 * 四个 runtime（builtin / Codex / Claude Code / Gemini）取数姿势不同，但都收敛到这
 * 一个 shape，前端用单一 `<ContextUsageIndicator>` 消费。归一化逻辑只在
 * `src/shared/contextUsage.ts::computeContextUsage` 一处纯函数里。
 *
 * 设计要点：
 * - 占用 = **最近一次 API 调用**的 input 系 token（非整 turn 聚合，避免多步工具轮高估）。
 *   两系 cache 语义相反：Anthropic 系（builtin/CC）`input` 不含 cache 需相加；
 *   OpenAI 系（Codex）`inputTokens` 已含 cached，不再加。详见 PRD §3.2。
 * - 分母永远有值：`runtime 报的窗口 ?? registry 查到 ?? 200K`，表示模型的有效完整窗口；
 *   builtin auto-compact 阈值由共享的 90% policy 单独投影，故 `contextWindow` / `usedPercent` 非空。
 */
export interface ContextUsage {
  /** 当前占用 token（最近一次调用的 input[+cache，按系]）。 */
  contextTokens: number;
  /** 有效窗口（分母）。永远有值，最低回落到 SDK 默认 200K。 */
  contextWindow: number;
  /** `min(100, contextTokens / contextWindow * 100)`。 */
  usedPercent: number;
  /** 产出该快照的 runtime。 */
  source: 'builtin' | 'codex' | 'claude-code' | 'gemini';
  /** 窗口来源：runtime 自报 / registry 查到 / 200K 兜底。用于卡片底部弱灰说明。 */
  windowSource: 'runtime' | 'registry' | 'default';
  /** 当前模型 id（已 strip `[1m]` 之前的原值，仅展示用）。 */
  model?: string;

  /**
   * 最近一次调用里由 prompt cache 命中的 token 数。
   *
   * 缓存命中是长会话的主要成本杠杆：命中部分按远低于新鲜输入的价格计费，
   * 而且命中率骤降往往正是「为什么这一轮变慢/变贵了」的答案（改动了系统提示、
   * 切换模型、上下文刚被压缩）。数据本来就随每次调用的 usage 到达，此前只是
   * 没有被投影到快照里。runtime 不报时为 undefined，UI 需自行区分「0%」与
   * 「未知」——两者含义完全不同。
   */
  cacheReadTokens?: number;

  /**
   * 构成当前占用的新鲜输入 token（未命中缓存的部分）。
   *
   * 与 `cacheReadTokens` 一起决定命中率分母。缺失时同样表示 runtime 未上报。
   */
  freshInputTokens?: number;
}
