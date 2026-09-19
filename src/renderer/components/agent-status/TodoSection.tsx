// PRD 0.2.17 — Agent Status Panel
//
// 展开态的 TODO 区：按当前 status 渲染 todo 列表。三态：pending / in_progress / completed。
// 不交互——Todo 是 AI 的工作记忆，只展示不编辑（PRD §2.2 非目标）。

import { memo } from 'react';

import { TodoCompletedIcon, TodoInProgressIcon, TodoPendingIcon } from './icons';
import type { TodoItem } from './types';

interface TodoSectionProps {
  todos: TodoItem[];
}

function TodoRow({ todo }: { todo: TodoItem }) {
  const isCompleted = todo.status === 'completed';
  const isInProgress = todo.status === 'in_progress';

  return (
    <div className="flex items-start gap-2 px-3 py-1.5">
      <span className="mt-0.5">
        {isCompleted ? (
          <TodoCompletedIcon />
        ) : isInProgress ? (
          <TodoInProgressIcon />
        ) : (
          <TodoPendingIcon />
        )}
      </span>
      <span
        className={
          isCompleted
            ? 'flex-1 text-sm text-[var(--ink-muted)] line-through select-text'
            : isInProgress
              ? 'flex-1 text-sm font-medium text-[var(--ink)] select-text'
              : 'flex-1 text-sm text-[var(--ink-secondary)] select-text'
        }
      >
        {todo.content}
      </span>
    </div>
  );
}

const MemoTodoRow = memo(TodoRow);

const TodoSection = memo(function TodoSection({ todos }: TodoSectionProps) {
  if (todos.length === 0) return null;
  const completed = todos.filter(t => t.status === 'completed').length;

  return (
    <div className="border-b border-[var(--line-subtle)] py-1.5 last:border-b-0">
      <div className="flex items-center justify-between px-3 pb-1 pt-0.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
          Todo
        </span>
        <span className="text-xs tabular-nums text-[var(--ink-muted)]">
          {completed}/{todos.length}
        </span>
      </div>
      {/* 上限 ~200px overflow auto——通常 todos < 20，不引虚拟化 */}
      <div className="max-h-[200px] overflow-y-auto">
        {todos.map(todo => (
          <MemoTodoRow key={todo.key} todo={todo} />
        ))}
      </div>
    </div>
  );
});

export default TodoSection;
