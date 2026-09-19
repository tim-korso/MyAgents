import type { TodoWriteInput, ToolUseSimple } from '@/types/chat';

interface TodoWriteResultShape {
  newTodos?: TodoWriteInput['todos'];
}

export function parseTodoWriteResult(result: string | undefined): TodoWriteResultShape | null {
  if (!result) return null;
  try {
    const parsed = JSON.parse(result) as TodoWriteResultShape;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function getEffectiveTodoWriteTodos(
  tool: Pick<ToolUseSimple, 'parsedInput' | 'result'>,
): TodoWriteInput['todos'] | undefined {
  const result = parseTodoWriteResult(tool.result);
  if (Array.isArray(result?.newTodos)) {
    return result.newTodos;
  }

  const inputTodos = (tool.parsedInput as TodoWriteInput | undefined)?.todos;
  return Array.isArray(inputTodos) ? inputTodos : undefined;
}
