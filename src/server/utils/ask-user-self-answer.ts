/**
 * Answering an AskUserQuestion without a human.
 *
 * Lives in its own module so it can be unit-tested without booting a session:
 * the decision is pure, and the failure it prevents (a turn parked forever) is
 * exactly the kind of thing that must not depend on integration wiring to be
 * verifiable.
 */

/** Minimal shape needed to decide; structurally compatible with AskUserQuestionInput. */
export interface SelfAnswerQuestion {
  id?: string;
  question: string;
  options: Array<{ label: string; description?: string }>;
  isSecret?: boolean;
}

export interface SelfAnswerInput {
  questions: SelfAnswerQuestion[];
}

function isAnswerableQuestion(value: unknown): value is SelfAnswerQuestion {
  if (!value || typeof value !== 'object') return false;
  const q = value as Record<string, unknown>;
  return typeof q.question === 'string'
    && q.question.trim().length > 0
    && Array.isArray(q.options)
    && q.options.length > 0
    && (q.isSecret === undefined || typeof q.isSecret === 'boolean');
}

/**
 * Pick answers from the model's own offered options.
 *
 * Why this exists: in `fullAgency` the session is allowed to act on its own,
 * yet AskUserQuestion resolves by *waiting* — and that wait has no wall-clock
 * timeout, while the inactivity watchdog deliberately treats a pending question
 * as "paused" rather than hung. The two together mean a question asked with
 * nobody attached parks the turn forever: no error, no timeout, no progress.
 *
 * Choice rule: the first option. Ordering is the only signal the protocol
 * carries — there is no `recommended`/`default` field — and models put their
 * preferred option first by convention.
 *
 * Secret questions are omitted from the result rather than guessed — a
 * fabricated credential is worse than an obviously missing answer. A mixed set
 * still returns the non-secret answers, so one secret prompt cannot block a
 * decision the model was able to make.
 *
 * Returns null (never a fabricated answer) when:
 *  - the input is malformed,
 *  - every question is secret,
 *  - an answerable question offers no usable option, or
 *  - there is nothing answerable at all.
 */
export function selfAnswerAskUserQuestion(input: unknown): Record<string, string> | null {
  if (!input || typeof input !== 'object') return null;
  const questions = (input as { questions?: unknown }).questions;
  if (!Array.isArray(questions) || questions.length === 0) return null;
  if (!questions.every(isAnswerableQuestion)) return null;

  const answerable = questions.filter((q) => !q.isSecret);
  if (answerable.length === 0) return null;

  const answers: Record<string, string> = {};
  for (const question of answerable) {
    const first = question.options[0];
    if (!first?.label) return null;
    // Keyed by question TEXT: the SDK looks answers up by text
    // (withQuestionTextAnswerKeys), and the renderer keys by index — text is
    // the form both sides agree on.
    answers[question.question] = first.label;
  }
  return answers;
}
