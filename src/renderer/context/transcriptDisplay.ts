import {
    applyTranscriptOperation, createTranscriptProjection, getTranscriptText,
    type TranscriptBlock, type TranscriptMessage, type TranscriptObject, type TranscriptOperation,
} from '../../shared/sessionTranscript';
import type { Message } from '@/types/chat';

function object(value: unknown): value is TranscriptObject {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function mergeToolPreview(previous: unknown, next: TranscriptObject): TranscriptObject {
    const previousTool = object(previous) ? previous : {};
    const previousCalls = Array.isArray(previousTool.subagentCalls) ? previousTool.subagentCalls : [];
    return {
        input: {}, ...previousTool, ...next,
        ...(Array.isArray(next.subagentCalls) ? {
            subagentCalls: next.subagentCalls.map(call => object(call)
                ? mergeToolPreview(previousCalls.find(old => object(old) && old.id === call.id), call) : call),
        } : {}),
    };
}

function mergeBlockPreview(previous: TranscriptBlock | undefined, next: TranscriptBlock): TranscriptBlock {
    return { ...next, ...(object(next.tool) ? { tool: mergeToolPreview(previous?.tool, next.tool) } : {}) };
}

/** Apply an ordered product update to one displayed row. The row can be a
 * truncated REST preview; only retained block IDs can be updated. UI text
 * lengths deliberately do not claim to be canonical log offsets.
 */
export function applyTranscriptDisplayOperation(message: Message, incoming: TranscriptOperation): Message {
    if (!('messageId' in incoming) || incoming.messageId !== message.id) return message;
    const canonical = { ...message, timestamp: message.timestamp.toISOString() } as unknown as TranscriptMessage;
    const blocks = Array.isArray(canonical.content) ? canonical.content : [];
    let operation = incoming;
    if ('blockId' in operation && operation.blockId) {
        const blockId = operation.blockId;
        const block = blocks.find(value => value.id === blockId);
        // An omitted block or unloaded nested call is a display boundary, not
        // a transport revision gap and not permission to invent its history.
        if (!block) return message;
        if (operation.kind === 'subagents-remove' && (!object(block.tool) || !Array.isArray(block.tool.subagentCalls))) return message;
        if ('subagentToolId' in operation && operation.subagentToolId) {
            const subagentToolId = operation.subagentToolId;
            const calls = object(block.tool) && Array.isArray(block.tool.subagentCalls) ? block.tool.subagentCalls : [];
            if (!calls.some(call => object(call) && call.id === subagentToolId)) return message;
        }
    }
    if (operation.kind === 'block-upsert') {
        const block = operation.block;
        operation = { ...operation, block: mergeBlockPreview(blocks.find(b => b.id === block.id), block) };
    } else if (operation.kind === 'subagent-upsert') {
        const { blockId, call: nextCall } = operation;
        const tool = blocks.find(b => b.id === blockId)?.tool;
        const calls = object(tool) && Array.isArray(tool.subagentCalls) ? tool.subagentCalls : [];
        operation = { ...operation, call: mergeToolPreview(calls.find(call => object(call) && call.id === nextCall.id), nextCall) as typeof operation.call };
    } else if (operation.kind === 'content-confirm' && Array.isArray(operation.content)) {
        operation = { ...operation, content: operation.content.map(block => mergeBlockPreview(blocks.find(b => b.id === block.id), block)) };
    } else if (operation.kind === 'block-update' && operation.target === 'tool' && Array.isArray(operation.details.subagentCalls)) {
        const blockId = operation.blockId;
        operation = { ...operation, details: {
            ...operation.details,
            subagentCalls: mergeToolPreview(blocks.find(block => block.id === blockId)?.tool, operation.details).subagentCalls,
        } };
    }
    const projection = createTranscriptProjection();
    projection.messages.set(message.id, canonical);
    if (operation.kind === 'text-append') {
        operation = { ...operation, offset: getTranscriptText(projection, operation).length };
    }
    if ((operation.kind === 'blocks-remove' || operation.kind === 'block-update') && typeof canonical.content === 'string') return message;
    applyTranscriptOperation(projection, operation);
    const updated = projection.messages.get(message.id)!;
    return { ...updated, timestamp: message.timestamp } as unknown as Message;
}
