import type { ToolUseSimple } from '@/types/chat';

import { ExpandableResult } from './utils';

interface KillShellToolProps {
  tool: ToolUseSimple;
}

export default function KillShellTool({ tool }: KillShellToolProps) {
  // No inner header — outer ProcessRow already labels this as "Kill Shell".
  if (!tool.result) return null;
  return (
    <ExpandableResult
      content={tool.result}
      className="rounded bg-[var(--paper-inset)]/50 px-2 py-1 break-words text-[var(--ink-secondary)]"
    />
  );
}
