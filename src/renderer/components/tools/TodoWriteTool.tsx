import type { ToolUseSimple } from '@/types/chat';
import { useTranslation } from 'react-i18next';

import { getEffectiveTodoWriteTodos } from '@/utils/todoWriteState';

import TodoChecklist from './TodoChecklist';

interface TodoWriteToolProps {
  tool: ToolUseSimple;
}

// Legacy renderer for the SDK <0.3.142 `TodoWrite` tool. Kept for backward-compatible
// replay of old sessions; new sessions emit Task tools rendered by TaskTodoTool.
export default function TodoWriteTool({ tool }: TodoWriteToolProps) {
  const { t } = useTranslation('chat');
  const todos = getEffectiveTodoWriteTodos(tool);

  if (!todos) {
    return <div className="text-sm text-[var(--ink-muted)]">{t('shell.toolChrome.taskOp.loadingTodos')}</div>;
  }

  return <TodoChecklist items={todos} />;
}
