import type { GlobInput, ToolUseSimple } from '@/types/chat';

import { getToolSummaryNode } from './toolBadgeConfig';
import { ExpandableResult, InlineCode, ToolHeader } from './utils';

interface GlobToolProps {
  tool: ToolUseSimple;
}

export default function GlobTool({ tool }: GlobToolProps) {
  const input = tool.parsedInput as GlobInput;

  if (!input) {
    return (
      <div className="my-0.5">
        <ToolHeader tool={tool} toolName={tool.name} />
      </div>
    );
  }

  const summary = getToolSummaryNode(tool);

  return (
    <div className="space-y-2">
      {/* Inner header (B2): pattern + path + summary chip, no tool name */}
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <InlineCode>{input.pattern}</InlineCode>
        {input.path && (
          <span className="text-xs text-[var(--ink-muted)]">in {input.path}</span>
        )}
        {summary}
      </div>

      {tool.result && (
        <ExpandableResult
          content={tool.result}
          className="rounded bg-[var(--paper-inset)]/50 px-2 py-1 break-words text-[var(--ink-secondary)]"
        />
      )}
    </div>
  );
}
