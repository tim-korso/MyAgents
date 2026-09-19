import { describe, expect, it } from 'vitest';

import {
  accumulateTaskTodos,
  getTaskListSnapshot,
  isTaskTodoTool,
  parseTaskCreateId,
  parseTaskListResult,
  type TaskToolCall,
} from './taskTodoState';

function create(id: string | undefined, subject: string, activeForm?: string): TaskToolCall {
  return {
    name: 'TaskCreate',
    parsedInput: { subject, description: subject, ...(activeForm ? { activeForm } : {}) },
    result: id ? JSON.stringify({ task: { id, subject } }) : undefined,
  };
}

function update(taskId: string, patch: Record<string, unknown>): TaskToolCall {
  return { name: 'TaskUpdate', parsedInput: { taskId, ...patch }, result: undefined };
}

function list(tasks: Array<{ id: string; subject: string; status: string }>): TaskToolCall {
  return { name: 'TaskList', parsedInput: {}, result: JSON.stringify({ tasks }) };
}

describe('isTaskTodoTool', () => {
  it('matches the four incremental Task tools but not the sub-agent launcher', () => {
    for (const n of ['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList']) {
      expect(isTaskTodoTool(n)).toBe(true);
    }
    expect(isTaskTodoTool('Task')).toBe(false); // sub-agent launcher — different tool
    expect(isTaskTodoTool('Agent')).toBe(false);
    expect(isTaskTodoTool('TodoWrite')).toBe(false);
    expect(isTaskTodoTool(undefined)).toBe(false);
  });
});

describe('parseTaskCreateId', () => {
  it('extracts the created task id from the result', () => {
    expect(parseTaskCreateId(JSON.stringify({ task: { id: 't1', subject: 'x' } }))).toBe('t1');
  });
  it('returns undefined for missing / malformed results', () => {
    expect(parseTaskCreateId(undefined)).toBeUndefined();
    expect(parseTaskCreateId('not json')).toBeUndefined();
    expect(parseTaskCreateId(JSON.stringify({ task: {} }))).toBeUndefined();
    expect(parseTaskCreateId(JSON.stringify({}))).toBeUndefined();
  });
});

describe('parseTaskListResult', () => {
  it('normalizes tasks and unknown statuses to pending', () => {
    const out = parseTaskListResult(JSON.stringify({
      tasks: [
        { id: 'a', subject: 'A', status: 'in_progress' },
        { id: 'b', subject: 'B', status: 'weird' },
        { subject: 'no id' },
      ],
    }));
    expect(out).toEqual([
      { id: 'a', subject: 'A', status: 'in_progress' },
      { id: 'b', subject: 'B', status: 'pending' },
    ]);
  });
  it('returns null when there is no tasks array', () => {
    expect(parseTaskListResult(undefined)).toBeNull();
    expect(parseTaskListResult('{}')).toBeNull();
  });
});

describe('accumulateTaskTodos', () => {
  it('builds the list in creation order from TaskCreate', () => {
    const todos = accumulateTaskTodos([
      create('t1', 'first', 'doing first'),
      create('t2', 'second'),
    ]);
    expect(todos).toEqual([
      { id: 't1', content: 'first', status: 'pending', activeForm: 'doing first' },
      { id: 't2', content: 'second', status: 'pending', activeForm: 'second' },
    ]);
  });

  it('applies status transitions via TaskUpdate (pending → in_progress → completed)', () => {
    const todos = accumulateTaskTodos([
      create('t1', 'build'),
      update('t1', { status: 'in_progress' }),
      update('t1', { status: 'completed' }),
    ]);
    expect(todos).toEqual([
      { id: 't1', content: 'build', status: 'completed', activeForm: 'build' },
    ]);
  });

  it('updates subject/activeForm without losing other fields', () => {
    const todos = accumulateTaskTodos([
      create('t1', 'old subject', 'old form'),
      update('t1', { subject: 'new subject' }),
    ]);
    expect(todos[0]).toMatchObject({ content: 'new subject', activeForm: 'old form' });
  });

  it('removes a task on status:deleted and preserves order of the rest', () => {
    const todos = accumulateTaskTodos([
      create('t1', 'one'),
      create('t2', 'two'),
      create('t3', 'three'),
      update('t2', { status: 'deleted' }),
    ]);
    expect(todos.map(t => t.id)).toEqual(['t1', 't3']);
  });

  it('skips a TaskCreate whose result has not arrived yet (streaming)', () => {
    const todos = accumulateTaskTodos([
      create('t1', 'ready'),
      create(undefined, 'still streaming'), // no id yet → not anchored
    ]);
    expect(todos.map(t => t.id)).toEqual(['t1']);
  });

  it('ignores TaskGet (read-only) and never mutates the list', () => {
    const todos = accumulateTaskTodos([
      create('t1', 'one'),
      { name: 'TaskGet', parsedInput: { taskId: 't1' }, result: JSON.stringify({ task: { id: 't1' } }) },
    ]);
    expect(todos).toHaveLength(1);
  });

  it('reconciles status from a TaskList snapshot for known ids', () => {
    const todos = accumulateTaskTodos([
      create('t1', 'one'),
      create('t2', 'two'),
      list([
        { id: 't1', subject: 'one', status: 'completed' },
        { id: 't2', subject: 'two', status: 'in_progress' },
      ]),
    ]);
    expect(todos).toEqual([
      { id: 't1', content: 'one', status: 'completed', activeForm: 'one' },
      { id: 't2', content: 'two', status: 'in_progress', activeForm: 'two' },
    ]);
  });

  it('adds tasks first seen in a TaskList snapshot (e.g. created before this window)', () => {
    const todos = accumulateTaskTodos([
      list([{ id: 'pre', subject: 'pre-existing', status: 'pending' }]),
    ]);
    expect(todos).toEqual([
      { id: 'pre', content: 'pre-existing', status: 'pending', activeForm: 'pre-existing' },
    ]);
  });

  it('prunes a task absent from an authoritative TaskList (deleted out-of-band)', () => {
    const todos = accumulateTaskTodos([
      create('t1', 'kept'),
      create('t2', 'gone'),
      list([{ id: 't1', subject: 'kept', status: 'completed' }]),
    ]);
    expect(todos.map(t => t.id)).toEqual(['t1']);
  });

  it('keeps tasks created AFTER a TaskList snapshot (not pruned)', () => {
    const todos = accumulateTaskTodos([
      create('t1', 'one'),
      list([{ id: 't1', subject: 'one', status: 'in_progress' }]),
      create('t2', 'created later'),
    ]);
    expect(todos.map(t => t.id)).toEqual(['t1', 't2']);
  });

  it('does not apply a TaskUpdate whose result reports success:false', () => {
    const todos = accumulateTaskTodos([
      create('t1', 'task'),
      { name: 'TaskUpdate', parsedInput: { taskId: 't1', status: 'completed' }, result: JSON.stringify({ success: false, error: 'not found' }) },
    ]);
    expect(todos[0].status).toBe('pending');
  });

  it('does not delete on a failed (success:false) deletion', () => {
    const todos = accumulateTaskTodos([
      create('t1', 'task'),
      { name: 'TaskUpdate', parsedInput: { taskId: 't1', status: 'deleted' }, result: JSON.stringify({ success: false }) },
    ]);
    expect(todos.map(t => t.id)).toEqual(['t1']);
  });

  it('does not reset an advanced status when a TaskCreate for the same id is replayed', () => {
    const todos = accumulateTaskTodos([
      create('t1', 'build'),
      update('t1', { status: 'completed' }),
      create('t1', 'build'), // duplicate/replayed create
    ]);
    expect(todos[0].status).toBe('completed');
  });

  it('does not spawn a blank row from a metadata-only update for an unknown task', () => {
    const todos = accumulateTaskTodos([
      update('unknown', { addBlockedBy: ['x'] }),
    ]);
    expect(todos).toEqual([]);
  });

  it('recovers content from the TaskCreate result subject when parsedInput is absent', () => {
    const todos = accumulateTaskTodos([
      { name: 'TaskCreate', parsedInput: undefined, result: JSON.stringify({ task: { id: 't1', subject: 'from result' } }) },
    ]);
    expect(todos[0]).toMatchObject({ id: 't1', content: 'from result' });
  });

  it('creates a stub if TaskUpdate arrives before its TaskCreate is anchored', () => {
    const todos = accumulateTaskTodos([
      update('ghost', { subject: 'recovered', status: 'in_progress' }),
    ]);
    expect(todos).toEqual([
      { id: 'ghost', content: 'recovered', status: 'in_progress', activeForm: 'recovered' },
    ]);
  });
});

describe('getTaskListSnapshot', () => {
  it('maps a TaskList result to renderable todos', () => {
    const snap = getTaskListSnapshot({
      result: JSON.stringify({ tasks: [{ id: 'a', subject: 'A', status: 'completed' }] }),
    });
    expect(snap).toEqual([{ id: 'a', content: 'A', status: 'completed', activeForm: 'A' }]);
  });
  it('returns undefined while the result is unavailable (streaming)', () => {
    expect(getTaskListSnapshot({ result: undefined })).toBeUndefined();
  });
});
