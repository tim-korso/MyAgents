import type { TranscriptContent, TranscriptObject, TranscriptOperation } from '../../shared/sessionTranscript';
import { shrinkReplayContentForClient } from '../utils/session-message-preview';

function object(value: unknown): value is TranscriptObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toolIdentity(tool: TranscriptObject): TranscriptObject {
  // Tool payloads keep the existing preview/ref SSE path. Sending raw result
  // appends here too would bypass that path and double a large tool response.
  const { input: _input, inputJson: _inputJson, parsedInput: _parsed, inputComplete: _complete, result: _result, ...details } = tool;
  return {
    ...details,
    ...(Array.isArray(tool.subagentCalls) ? { subagentCalls: tool.subagentCalls.map(call => object(call) ? toolIdentity(call) : call) } : {}),
  };
}

function displayContent(content: TranscriptContent): TranscriptContent {
  const value = typeof content === 'string' ? content : content.map(block => ({
    ...block, ...(object(block.tool) ? { tool: toolIdentity(block.tool) } : {}),
  }));
  return shrinkReplayContentForClient(value) as TranscriptContent;
}

/** Stable display targets, not a second raw transcript transport. The renderer
 * already owns bounded tool previews and paced text, so disk offsets are not
 * display offsets. Ordered liveRevision is the transport continuity contract.
 */
export function toClientTranscriptOperation(operation: TranscriptOperation): TranscriptOperation | null {
  switch (operation.kind) {
    case 'text-append':
      return operation.field === 'inputJson' || operation.field === 'result' ? null : operation;
    case 'message-create':
      return { ...operation, message: { ...operation.message, content: displayContent(operation.message.content) } };
    case 'content-confirm':
      return { ...operation, content: displayContent(operation.content) };
    case 'block-upsert':
      return { ...operation, block: { ...operation.block, ...(object(operation.block.tool) ? { tool: toolIdentity(operation.block.tool) } : {}) } };
    case 'subagent-upsert':
      return { ...operation, call: toolIdentity(operation.call) as typeof operation.call };
    case 'block-update': {
      if (operation.target !== 'tool') return operation;
      const details = toolIdentity(operation.details);
      return Object.keys(details).length ? { ...operation, details } : null;
    }
    default:
      return operation;
  }
}
