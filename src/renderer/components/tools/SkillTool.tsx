import type { ToolUseSimple } from '@/types/chat';

import { ExpandableResult } from './utils';

interface SkillToolProps {
  tool: ToolUseSimple;
}

export default function SkillTool({ tool }: SkillToolProps) {
  // No inner header — outer ProcessRow already shows "Skill(<name>)"
  // Just surface the result directly (height-clamped if long).
  if (!tool.result) return null;
  return (
    <ExpandableResult
      content={tool.result}
      className="rounded bg-[var(--paper-inset)]/50 px-2 py-1 wrap-break-word text-[var(--ink-secondary)]"
    />
  );
}
