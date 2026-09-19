import type { Query } from '@anthropic-ai/claude-agent-sdk';
import { withBoundedTimeout } from '../utils/cancellation';
import { reconcileInterruptReceipt } from '../utils/inflight-terminal';

type InterruptQuery = Pick<Query, 'interrupt'>;
type TerminalOutcome = 'result-claimed' | 'session-ended';
type InterruptOperation = {
  query: InterruptQuery;
  queueId: string | null;
  outcome: TerminalOutcome | null;
  survivingQueueIds: ReadonlySet<string> | null;
  finished: boolean;
  terminal: Promise<TerminalOutcome>;
  settle: (outcome: TerminalOutcome) => void;
  completion: Promise<boolean>;
};

export type BuiltinInterruptDeps = {
  getQuery: () => InterruptQuery | null;
  getInFlightQueueId: () => string | null;
  setInterruptingQueueId: (id: string | null) => void;
  dropCancelledInFlight: () => void;
  scheduleDrain: () => void;
  /** Close only this exact Query, rescuing pending items before teardown. */
  forceClose: (query: InterruptQuery, phase: 'receipt' | 'terminal') => void;
  finishStopped: () => void;
};

/** Existing builtin interrupt state, scoped to one request and its target terminal.
 * A terminal releases cancellation authority even while the control receipt is
 * pending. Keep that receipt eligible only until another request supersedes it.
 */
export function createBuiltinInterruptController(deps: BuiltinInterruptDeps) {
  let latest: InterruptOperation | null = null;
  const ownsQuery = (op: InterruptOperation) => latest === op && deps.getQuery() === op.query;
  const isInterrupting = () => latest !== null && ownsQuery(latest)
    && !latest.finished && latest.outcome === null;

  const run = async (op: InterruptOperation): Promise<boolean> => {
    try {
      const receipt = reconcileInterruptReceipt({
        requestReceipt: () => op.query.interrupt(),
        isCurrentOwner: () => ownsQuery(op),
        getPostInterruptOutcome: () => op.outcome,
        interruptTargetQueueId: op.queueId,
        getCurrentQueueId: deps.getInFlightQueueId,
        onReceipt: stillQueued => {
          op.survivingQueueIds = stillQueued;
          console.log(`[agent] Interrupt receipt: stillQueued=${stillQueued.size}`);
        },
        onUnavailable: () => console.log('[agent] Interrupt receipt unavailable (older CLI capability)'),
        dropExactInFlight: deps.dropCancelledInFlight,
        scheduleDrain: deps.scheduleDrain,
      }).then(() => 'receipt' as const, error => {
        // A late control failure is still diagnostic evidence, but cannot
        // cancel a successor after this request's target has already ended.
        console.error('[agent] Interrupt request failed:', error);
        return 'failed' as const;
      });
      const first = await withBoundedTimeout(
        Promise.race([receipt, op.terminal.then(() => 'terminal' as const)]),
        5000,
        () => console.error('[agent] Interrupt failed or timed out (5s): Interrupt timeout'),
      );
      // Neither an old receipt nor its timeout may mutate a replacement Query
      // or a subsequent interrupt request in this same persistent Query.
      if (!ownsQuery(op)) return op.outcome !== null;
      if (first === 'receipt' && op.outcome === null) {
        await withBoundedTimeout(op.terminal, 3000, () => {
          console.warn('[agent] Turn did not complete 3s after interrupt');
        });
      }
      if (!ownsQuery(op)) return op.outcome !== null;
      if (op.outcome === null) {
        deps.forceClose(op.query, first === 'receipt' ? 'terminal' : 'receipt');
        deps.finishStopped();
      }
      return true;
    } finally {
      op.finished = true;
      if (latest === op) deps.setInterruptingQueueId(null);
    }
  };

  return {
    isInterrupting,
    didInFlightSurvive: (id: string): boolean | null =>
      latest && ownsQuery(latest) ? latest.survivingQueueIds?.has(id) ?? null : null,
    settleTerminal(query: InterruptQuery | null, outcome: TerminalOutcome): void {
      const op = latest;
      if (!op || op.query !== query || op.finished || op.outcome !== null) return;
      op.outcome = outcome;
      // The iterator is about to clear Query and current-turn state. Claim its
      // no-result Stop synchronously, before those owners can be replaced.
      if (outcome === 'session-ended' && ownsQuery(op)) deps.finishStopped();
      op.settle(outcome);
    },
    interrupt(): Promise<boolean> {
      if (isInterrupting()) return latest!.completion;
      const query = deps.getQuery();
      if (!query) return Promise.resolve(false);
      let settle!: InterruptOperation['settle'];
      const terminal = new Promise<TerminalOutcome>(resolve => { settle = resolve; });
      const op: InterruptOperation = {
        query, queueId: deps.getInFlightQueueId(), outcome: null,
        survivingQueueIds: null, finished: false, terminal, settle,
        completion: Promise.resolve(false),
      };
      latest = op;
      deps.setInterruptingQueueId(op.queueId);
      op.completion = run(op);
      return op.completion;
    },
  };
}
