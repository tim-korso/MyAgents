// PRD 0.2.17 — Agent Status Panel
//
// 时间 / token 格式化工具。token 复用 TaskTool.tsx 已有约定（k/M），
// 时间格式按 PRD §8.3：< 1h 用 m:ss，≥ 1h 用 Hh Mm。

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(2)}M`;
}

/** 把 ms 转成 "1:24" 或 "15m 9s" 或 "1h 5m"。负值兜底为 0。 */
export function formatElapsed(ms: number): string {
  const safe = Math.max(0, ms);
  const totalSeconds = Math.floor(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours >= 1) {
    return `${hours}h ${minutes}m`;
  }
  // < 1h，用 m:ss 节省宽度
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
