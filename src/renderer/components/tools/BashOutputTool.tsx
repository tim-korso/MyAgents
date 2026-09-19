import type { ToolUseSimple } from '@/types/chat';

import { ExpandableResult } from './utils';

interface BashOutputToolProps {
  tool: ToolUseSimple;
}

export default function BashOutputTool({ tool }: BashOutputToolProps) {
  // No inner header — outer ProcessRow already labels this as "Bash Output".
  if (!tool.result) return null;
  return (
    <ExpandableResult
      content={tool.result}
      className="rounded bg-[var(--paper-inset)]/50 px-2 py-1 wrap-break-word text-[var(--ink-secondary)]"
    />
  );
}
