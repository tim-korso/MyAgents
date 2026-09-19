import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { i18n } from '@/i18n';
import type { ToolUseSimple } from '@/types/chat';

import TaskTodoTool from './TaskTodoTool';
import { getToolLabel } from './toolBadgeConfig';

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('zh-CN');
});

function tool(overrides: Partial<ToolUseSimple>): ToolUseSimple {
  return { id: 'toolu_task', name: 'TaskCreate', input: {}, streamIndex: 0, ...overrides };
}

describe('TaskTodoTool', () => {
  it('renders a TaskList result as a checklist with completion count', () => {
    render(<TaskTodoTool tool={tool({
      name: 'TaskList',
      result: JSON.stringify({
        tasks: [
          { id: 'a', subject: '写代码', status: 'completed', blockedBy: [] },
          { id: 'b', subject: '跑测试', status: 'in_progress', blockedBy: [] },
        ],
      }),
    })} />);

    expect(screen.getByText('1/2 已完成')).toBeInTheDocument();
    expect(screen.getByText('写代码')).toBeInTheDocument();
    expect(screen.getByText('跑测试')).toBeInTheDocument();
  });

  it('renders a TaskCreate op with its subject', () => {
    render(<TaskTodoTool tool={tool({ name: 'TaskCreate', parsedInput: { subject: '初始化项目', description: '' } })} />);
    expect(screen.getByText('创建任务：初始化项目')).toBeInTheDocument();
  });

  it('renders a completed TaskUpdate distinctly', () => {
    render(<TaskTodoTool tool={tool({ name: 'TaskUpdate', parsedInput: { taskId: 'a', subject: '写代码', status: 'completed' } })} />);
    expect(screen.getByText('完成：写代码')).toBeInTheDocument();
  });

  it('shows a loading state for a TaskList whose result has not arrived', () => {
    render(<TaskTodoTool tool={tool({ name: 'TaskList' })} />);
    expect(screen.getByText('加载任务列表...')).toBeInTheDocument();
  });

  it('localizes operation chrome while preserving task subject data', async () => {
    await i18n.changeLanguage('en-US');

    render(<TaskTodoTool tool={tool({ name: 'TaskCreate', parsedInput: { subject: '初始化项目', description: '' } })} />);

    expect(screen.getByText('Create task: 初始化项目')).toBeInTheDocument();
  });
});

describe('getToolLabel for Task tools', () => {
  it('summarizes TaskList completion in the compact label', () => {
    expect(getToolLabel(tool({
      name: 'TaskList',
      result: JSON.stringify({ tasks: [
        { id: 'a', subject: 'A', status: 'completed', blockedBy: [] },
        { id: 'b', subject: 'B', status: 'pending', blockedBy: [] },
      ] }),
    }))).toBe('任务 1/2');
  });

  it('labels a TaskCreate even when parsedInput is missing (streaming)', () => {
    expect(getToolLabel(tool({ name: 'TaskCreate' }))).toBe('新建任务');
  });

  it('labels a completed TaskUpdate', () => {
    expect(getToolLabel(tool({ name: 'TaskUpdate', parsedInput: { taskId: 'a', subject: 'A', status: 'completed' } }))).toBe('完成：A');
  });
});
