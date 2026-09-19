import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import type { SessionGoal } from '@/types/sessionGoal';
import GoalStatusBar from './GoalStatusBar';

function goal(overrides: Partial<SessionGoal> = {}): SessionGoal {
  return {
    id: 'goal-1',
    workspacePath: '/workspace',
    sessionId: 'session-1',
    objective: 'Finish the release',
    status: 'active',
    endConditions: { aiCanExit: true },
    notifyEnabled: true,
    permissionMode: '',
    turnCount: 3,
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
    totalDurationMs: 0,
    totalTokens: 0,
    revision: 1,
    controlRevision: 1,
    isExecuting: false,
    ...overrides,
  };
}

describe('GoalStatusBar', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US');
  });

  it('shows a live Goal round and explicit cancel action', () => {
    render(
      <GoalStatusBar
        goal={goal({ isExecuting: true, executionNumber: 4 })}
        isExecuting
        executionNumber={4}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText(/Round 4.*Finish the release/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel goal' })).toBeInTheDocument();
  });

  it('keeps resume and cancel available while paused', () => {
    render(
      <GoalStatusBar
        goal={goal({ status: 'paused' })}
        onResume={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel goal' })).toBeInTheDocument();
  });

  it('shows whole-Goal execution totals after terminal settlement', () => {
    render(
      <GoalStatusBar
        goal={goal({
          status: 'complete',
          terminalReason: 'Goal achieved',
          totalDurationMs: 125_000,
          totalTokens: 12_345,
        })}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText('Total time 2m 5s · Total usage 12.3K tokens')).toBeInTheDocument();
    expect(screen.queryByText('Goal achieved')).not.toBeInTheDocument();
  });

  it('shows explicit zero totals instead of a live-round fallback', () => {
    render(<GoalStatusBar goal={goal({ status: 'complete', turnCount: 0 })} />);

    expect(screen.getByText('Total time 0ms · Total usage 0 tokens')).toBeInTheDocument();
    expect(screen.queryByText(/Round/)).not.toBeInTheDocument();
  });

  it('does not expose incomplete totals while the terminal turn is settling', () => {
    render(
      <GoalStatusBar
        goal={goal({
          status: 'complete',
          isExecuting: true,
          totalDurationMs: 60_000,
          totalTokens: 1_000,
        })}
        isExecuting
      />,
    );

    expect(screen.getByText('Finalizing goal summary...')).toBeInTheDocument();
    expect(screen.queryByText(/Total usage/)).not.toBeInTheDocument();
  });
});
