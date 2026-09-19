import type { ToolUseSimple } from '@/types/chat';

import FilePatchTool from './FilePatchTool';

interface WriteToolProps {
  tool: ToolUseSimple;
}

export default function WriteTool({ tool }: WriteToolProps) {
  return <FilePatchTool tool={tool} />;
}
