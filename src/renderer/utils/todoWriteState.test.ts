import { describe, expect, it } from 'vitest';

import type { ToolUseSimple } from '@/types/chat';

import { getEffectiveTodoWriteTodos } from './todoWriteState';

function todoTool(overrides: Partial<ToolUseSimple>): ToolUseSimple {
  return {
    id: 'toolu_todo',
    name: 'TodoWrite',
    input: {},
    streamIndex: 0,
    ...overrides,
  };
}

describe('getEffectiveTodoWriteTodos', () => {
  it('prefers SDK result newTodos over stale parsed input', () => {
    const todos = getEffectiveTodoWriteTodos(todoTool({
      parsedInput: {
        todos: [{ content: 'check docs', status: 'pending', activeForm: 'checking docs' }],
      },
      result: JSON.stringify({
        newTodos: [{ content: 'check docs', status: 'completed', activeForm: 'checked docs' }],
      }),
    }));

    expect(todos).toEqual([
      { content: 'check docs', status: 'completed', activeForm: 'checked docs' },
    ]);
  });

  it('treats an empty SDK result todo list as authoritative', () => {
    const todos = getEffectiveTodoWriteTodos(todoTool({
      parsedInput: {
        todos: [{ content: 'old item', status: 'pending', activeForm: 'doing old item' }],
      },
      result: JSON.stringify({ newTodos: [] }),
    }));

    expect(todos).toEqual([]);
  });

  it('falls back to parsed input while the tool result is unavailable', () => {
    const todos = getEffectiveTodoWriteTodos(todoTool({
      parsedInput: {
        todos: [{ content: 'new item', status: 'in_progress', activeForm: 'doing new item' }],
      },
    }));

    expect(todos).toEqual([
      { content: 'new item', status: 'in_progress', activeForm: 'doing new item' },
    ]);
  });
});
