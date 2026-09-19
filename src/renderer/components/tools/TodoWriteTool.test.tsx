import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import type { ToolUseSimple } from '@/types/chat';

import TodoWriteTool from './TodoWriteTool';
import { getToolLabel } from './toolBadgeConfig';

afterEach(() => cleanup());

function todoToolWithResult(): ToolUseSimple {
  return {
    id: 'toolu_todo',
    name: 'TodoWrite',
    input: {},
    streamIndex: 0,
    parsedInput: {
      todos: [
        {
          content: '全面检查文档，确保所有不符合要求的新增内容已删除',
          status: 'pending',
          activeForm: '正在检查文档',
        },
      ],
    },
    result: JSON.stringify({
      oldTodos: [
        {
          content: '全面检查文档，确保所有不符合要求的新增内容已删除',
          status: 'pending',
          activeForm: '正在检查文档',
        },
      ],
      newTodos: [
        {
          content: '全面检查文档，确保所有不符合要求的新增内容已删除',
          status: 'completed',
          activeForm: '已检查文档',
        },
      ],
    }),
    isLoading: false,
  };
}

describe('TodoWriteTool', () => {
  it('renders the SDK result newTodos instead of stale input todos', () => {
    render(<TodoWriteTool tool={todoToolWithResult()} />);

    expect(screen.getByText('1/1 已完成')).toBeInTheDocument();
    expect(screen.queryByText('0/1 已完成')).not.toBeInTheDocument();
  });

  it('uses SDK result newTodos for the compact process label', () => {
    expect(getToolLabel(todoToolWithResult())).toBe('待办 1/1');
  });

  it('uses SDK result newTodos for the compact label even if parsed input is missing', () => {
    const { parsedInput: _parsedInput, ...tool } = todoToolWithResult();

    expect(getToolLabel(tool)).toBe('待办 1/1');
  });
});
