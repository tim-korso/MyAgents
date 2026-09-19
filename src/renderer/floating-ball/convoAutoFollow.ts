/**
 * 伴侣窗会话流的「贴底跟随」判定（纯函数，unit 池可测）。
 *
 * 为什么存在：自动滚底如果无条件执行，用户用滚轮上翻阅读的第一程就会被
 * 流式新内容拽回底部（0612 验收：peek 滚轮升格 pin 后想读历史读不了）。
 * 约定：只有本就贴底（距底 < FOLLOW_THRESHOLD_PX）时才跟随新内容；
 * 显式唤起 / 发送消息时由调用方强制回贴底。
 */
export const FOLLOW_THRESHOLD_PX = 48;

export interface ScrollMetrics {
    scrollHeight: number;
    scrollTop: number;
    clientHeight: number;
}

export function isNearBottom(m: ScrollMetrics): boolean {
    return m.scrollHeight - m.scrollTop - m.clientHeight < FOLLOW_THRESHOLD_PX;
}
