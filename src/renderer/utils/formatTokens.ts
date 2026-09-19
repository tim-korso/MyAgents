/**
 * Format token count for display with smart unit selection
 * - >= 1M: "1.2M"
 * - >= 1K: "12.5K"
 * - < 1K: raw number
 */
export function formatTokens(tokens: number): string {
    if (tokens >= 1000000) {
        return `${(tokens / 1000000).toFixed(1)}M`;
    }
    if (tokens >= 1000) {
        return `${(tokens / 1000).toFixed(1)}K`;
    }
    return String(tokens);
}

/**
 * Format duration in milliseconds for display
 * - >= 1h: "1h 8m"
 * - >= 60s: "1m 30s"
 * - >= 1s: "1.5s"
 * - < 1s: "500ms"
 */
export function formatDuration(ms: number): string {
    const safeMs = Math.max(0, Math.round(ms));
    const totalSeconds = Math.round(safeMs / 1000);
    if (totalSeconds >= 3600) {
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }
    if (totalSeconds >= 60) {
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
    }
    if (safeMs >= 1000) {
        return `${(safeMs / 1000).toFixed(1)}s`;
    }
    return `${safeMs}ms`;
}
