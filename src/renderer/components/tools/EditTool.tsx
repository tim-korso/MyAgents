import type { ToolUseSimple } from '@/types/chat';

import FilePatchTool from './FilePatchTool';

interface EditToolProps {
  tool: ToolUseSimple;
}

export default function EditTool({ tool }: EditToolProps) {
  return <FilePatchTool tool={tool} />;
}
