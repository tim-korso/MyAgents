import { isTauriEnvironment } from '@/utils/browserMock';
import type { GoalStatus, SessionGoal, SessionGoalConfig } from '@/types/sessionGoal';

let cachedInvoke: typeof import('@tauri-apps/api/core').invoke | null = null;

async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriEnvironment()) {
    throw new Error('Session Goal is only available in the desktop app');
  }
  if (!cachedInvoke) {
    const { invoke } = await import('@tauri-apps/api/core');
    cachedInvoke = invoke;
  }
  return cachedInvoke<T>(command, args);
}

export const createSessionGoal = (config: SessionGoalConfig): Promise<SessionGoal> =>
  invokeCommand('cmd_create_session_goal', { config });

export const getSessionGoal = (
  sessionId: string,
  workspacePath?: string,
  includeTerminal = true,
): Promise<SessionGoal | null> =>
  invokeCommand('cmd_get_session_goal', { sessionId, workspacePath, includeTerminal });

export const pauseSessionGoal = (goalId: string): Promise<SessionGoal> =>
  invokeCommand('cmd_pause_session_goal', { goalId });

export const resumeSessionGoal = (goalId: string): Promise<SessionGoal> =>
  invokeCommand('cmd_resume_session_goal', { goalId });

export const markSessionGoalTerminal = (
  goalId: string,
  status: GoalStatus,
  reason?: string,
): Promise<SessionGoal> =>
  invokeCommand('cmd_mark_session_goal_terminal', { goalId, status, reason });
