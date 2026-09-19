import { Check, CircleDot, ListTodo, Plus, Search, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { TaskCreateInput, TaskGetInput, TaskUpdateInput, ToolUseSimple } from '@/types/chat';

import { getTaskListSnapshot } from '@/utils/taskTodoState';

import TodoChecklist from './TodoChecklist';

interface TaskTodoToolProps {
  tool: ToolUseSimple;
}

// Renderer for the SDK 0.3.142+ incremental Task tools
// (TaskCreate / TaskUpdate / TaskGet / TaskList) that replaced TodoWrite.
//
// The aggregated "current task list" lives in the Agent Status Panel
// (useAgentStatusState accumulates across all messages). Here each tool *call*
// renders only its own operation — except TaskList, whose result already carries
// the full snapshot, so it shows the checklist directly.
export default function TaskTodoTool({ tool }: TaskTodoToolProps) {
  const { t } = useTranslation('chat');
  if (tool.name === 'TaskList') {
    const snapshot = getTaskListSnapshot(tool);
    if (!snapshot) {
      return <div className="text-sm text-[var(--ink-muted)]">{t('shell.toolChrome.taskOp.loadingList')}</div>;
    }
    if (snapshot.length === 0) {
      return <div className="text-sm text-[var(--ink-muted)]">{t('shell.toolChrome.taskOp.emptyList')}</div>;
    }
    return <TodoChecklist items={snapshot.map(task => ({ content: task.content, status: task.status, key: task.id }))} />;
  }

  return <TaskOpRow tool={tool} />;
}

function TaskOpRow({ tool }: { tool: ToolUseSimple }) {
  const { t } = useTranslation('chat');
  const { icon, text, accent } = describeTaskOp(tool, t);
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={accent ? 'text-[var(--accent)]' : 'text-[var(--ink-muted)]'}>{icon}</span>
      <span className="select-text text-[var(--ink-secondary)]">{text}</span>
    </div>
  );
}

type ChatTranslator = (key: string, options?: Record<string, unknown>) => string;

function describeTaskOp(tool: ToolUseSimple, t: ChatTranslator): { icon: React.ReactNode; text: string; accent: boolean } {
  const iconCls = 'size-4 shrink-0';
  switch (tool.name) {
    case 'TaskCreate': {
      const input = tool.parsedInput as TaskCreateInput | undefined;
      const subject = typeof input?.subject === 'string' ? input.subject : '';
      return {
        icon: <Plus className={iconCls} />,
        text: subject ? t('shell.toolChrome.taskOp.createWithSubject', { subject }) : t('shell.toolChrome.taskOp.create'),
        accent: false
      };
    }
    case 'TaskUpdate': {
      const input = tool.parsedInput as TaskUpdateInput | undefined;
      const subject = typeof input?.subject === 'string' ? input.subject : '';
      if (input?.status === 'deleted') {
        return { icon: <Trash2 className={iconCls} />, text: subject ? t('shell.toolChrome.taskOp.deleteWithSubject', { subject }) : t('shell.toolChrome.taskOp.delete'), accent: false };
      }
      if (input?.status === 'completed') {
        return { icon: <Check className={iconCls} strokeWidth={3} />, text: subject ? t('shell.toolChrome.taskOp.completeWithSubject', { subject }) : t('shell.toolChrome.taskOp.complete'), accent: false };
      }
      if (input?.status === 'in_progress') {
        return { icon: <CircleDot className={iconCls} />, text: subject ? t('shell.toolChrome.taskOp.startWithSubject', { subject }) : t('shell.toolChrome.taskOp.start'), accent: true };
      }
      return { icon: <ListTodo className={iconCls} />, text: subject ? t('shell.toolChrome.taskOp.updateWithSubject', { subject }) : t('shell.toolChrome.taskOp.update'), accent: false };
    }
    case 'TaskGet': {
      const input = tool.parsedInput as TaskGetInput | undefined;
      const id = typeof input?.taskId === 'string' ? input.taskId : '';
      return { icon: <Search className={iconCls} />, text: id ? t('shell.toolChrome.taskOp.getWithId', { id }) : t('shell.toolChrome.taskOp.get'), accent: false };
    }
    default:
      return { icon: <ListTodo className={iconCls} />, text: tool.name, accent: false };
  }
}
