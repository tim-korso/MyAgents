import type { Message, ToolUseSimple, SubagentToolCall, ToolInput, ToolAttachment, ToolResultMeta } from '@/types/chat';
import { parsePartialJson } from '@/utils/parsePartialJson';
import { isSubagentContainerTool } from '@/components/tools/toolBadgeConfig';

/** Existing bounded tool preview/ref events enrich V2 identities; they never
 * create blocks or decide which assistant segment owns a tool. */
export interface TranscriptToolDisplayEvent {
    tool?: { id: string; name: string; input?: Record<string, unknown> };
    toolId?: string;
    toolUseId?: string;
    parentToolUseId?: string;
    delta?: string;
    content?: string;
    input?: Record<string, unknown>;
    inputRef?: unknown;
    finalInput?: boolean;
    isError?: boolean;
    metadata?: ToolResultMeta;
    attachments?: ToolAttachment[];
    pendingId?: string;
    attachment?: ToolAttachment;
    usage?: { input_tokens?: number; output_tokens?: number };
}

export const TRANSCRIPT_TOOL_DISPLAY_EVENTS = new Set([
    'chat:tool-use-start', 'chat:server-tool-use-start', 'chat:tool-input-delta',
    'chat:content-block-stop', 'chat:tool-result-start', 'chat:tool-result-delta',
    'chat:tool-result-complete', 'chat:tool-attachment-update',
    'chat:subagent-tool-use', 'chat:subagent-tool-input-delta',
    'chat:subagent-tool-result-start', 'chat:subagent-tool-result-delta',
    'chat:subagent-tool-result-complete', 'chat:subagent-tool-attachment-update',
]);

export function mergeToolAttachments(existing: ToolAttachment[] | undefined, incoming: ToolAttachment[] | undefined): ToolAttachment[] | undefined {
    if (!incoming) return existing;
    if (!existing) return incoming;
    return incoming.map(attachment => {
        const key = attachment.pendingId || attachment.refPath;
        const previous = existing.find(value => (value.pendingId || value.refPath) === key);
        return previous?.refPath && !previous.pendingId ? previous : attachment;
    });
}

function appendPreview(previous: string | undefined, delta: string): string {
    const text = (previous ?? '') + delta;
    return text.length <= 8192 ? text : `${text.slice(0, 7168)}\n…[truncated for display; full result available on completion]…\n${text.slice(-1024)}`;
}

function updateTool<T extends SubagentToolCall>(tool: T, eventName: string, payload: TranscriptToolDisplayEvent): T {
    if (eventName.endsWith('tool-input-delta')) {
        const inputJson = appendPreview(tool.inputJson, payload.delta ?? '');
        return { ...tool, inputJson, parsedInput: parsePartialJson<ToolInput>(inputJson) ?? tool.parsedInput };
    }
    if (eventName.endsWith('tool-result-delta')) {
        return { ...tool, result: appendPreview(tool.result, payload.delta ?? '') };
    }
    if (eventName.endsWith('tool-result-start') || eventName.endsWith('tool-result-complete')) {
        return {
            ...tool, result: payload.content ?? tool.result,
            ...(typeof payload.isError === 'boolean' ? { isError: payload.isError } : {}),
            resultMeta: payload.metadata ?? tool.resultMeta,
            attachments: mergeToolAttachments(tool.attachments, payload.attachments),
        };
    }
    if (eventName.endsWith('tool-attachment-update') && payload.attachment) {
        return { ...tool, attachments: tool.attachments?.map(attachment => attachment.pendingId === payload.pendingId ? payload.attachment! : attachment) };
    }
    const input = payload.input ?? payload.tool?.input;
    if (input && !payload.inputRef && (Object.keys(input).length > 0 || payload.finalInput || eventName === 'chat:content-block-stop')) {
        return { ...tool, input, inputJson: undefined, parsedInput: input as ToolInput };
    }
    return tool;
}

export function applyTranscriptToolDisplayEvent(message: Message, eventName: string, data: unknown): Message {
    if (!TRANSCRIPT_TOOL_DISPLAY_EVENTS.has(eventName) || message.role !== 'assistant' || typeof message.content === 'string') return message;
    const payload = data as TranscriptToolDisplayEvent;
    const start = eventName === 'chat:tool-use-start' || eventName === 'chat:server-tool-use-start';
    const toolPayload = start ? { tool: data as NonNullable<TranscriptToolDisplayEvent['tool']> } : payload;
    const toolId = toolPayload.tool?.id ?? payload.toolId ?? payload.toolUseId;
    if (!toolId) return message;
    const parentId = payload.parentToolUseId;
    const index = message.content.findIndex(block => block.tool?.id === (parentId ?? toolId));
    const block = message.content[index];
    if (!block?.tool) return message;
    let tool: ToolUseSimple = block.tool;
    if (parentId) {
        const calls = tool.subagentCalls;
        if (!calls?.some(call => call.id === toolId)) return message;
        tool = { ...tool, subagentCalls: calls.map(call => call.id === toolId ? updateTool(call, eventName, toolPayload) : call) };
    } else {
        tool = updateTool(tool, eventName, toolPayload);
        if (start && isSubagentContainerTool(tool.name)) {
            tool = { ...tool, taskStartTime: tool.taskStartTime ?? message.timestamp.getTime(), taskStats: tool.taskStats ?? { toolCount: 0, inputTokens: 0, outputTokens: 0 } };
        }
    }
    if (tool === block.tool) return message;
    const content = [...message.content];
    content[index] = { ...block, tool };
    return { ...message, content };
}
