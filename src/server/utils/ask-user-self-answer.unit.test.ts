import { describe, expect, it } from 'vitest';

import { selfAnswerAskUserQuestion } from './ask-user-self-answer';

function question(partial: Partial<{
  question: string;
  options: Array<{ label: string; description?: string }>;
  isSecret: boolean;
}> = {}) {
  return {
    question: 'Which database should I use?',
    options: [
      { label: 'SQLite', description: 'embedded' },
      { label: 'Postgres', description: 'server' },
    ],
    ...partial,
  };
}

// A turn parked on an unanswered question has no timeout and the inactivity
// watchdog treats it as paused, so it never surfaces as an error — it just
// stops. These cases pin the behaviour that keeps a fullAgency turn moving.
describe('selfAnswerAskUserQuestion', () => {
  it("answers with the model's first option, keyed by question text", () => {
    expect(selfAnswerAskUserQuestion({ questions: [question()] })).toEqual({
      'Which database should I use?': 'SQLite',
    });
  });

  it('answers every question in the set', () => {
    const answers = selfAnswerAskUserQuestion({
      questions: [
        question(),
        question({
          question: 'Which test runner?',
          options: [{ label: 'vitest' }, { label: 'jest' }],
        }),
      ],
    });

    expect(answers).toEqual({
      'Which database should I use?': 'SQLite',
      'Which test runner?': 'vitest',
    });
  });

  it('never invents a secret', () => {
    // A fabricated credential is worse than reporting that one is needed, so a
    // secret question defers to the interactive path.
    expect(selfAnswerAskUserQuestion({
      questions: [question({ isSecret: true, request: 'API key' } as never)],
    })).toBeNull();
  });

  it('answers the answerable questions and omits the secret one', () => {
    // A mixed set must not be blocked by one secret question: the model needs
    // the non-secret decision to keep moving, and the unanswered secret stays
    // visibly unanswered rather than being guessed.
    expect(selfAnswerAskUserQuestion({
      questions: [
        question(),
        question({ question: 'API key?', isSecret: true, options: [{ label: 'paste it' }] }),
      ],
    })).toEqual({ 'Which database should I use?': 'SQLite' });
  });

  it('defers when a question offers no options to choose from', () => {
    expect(selfAnswerAskUserQuestion({
      questions: [question({ options: [] })],
    })).toBeNull();
  });

  it('rejects malformed input instead of guessing', () => {
    expect(selfAnswerAskUserQuestion(null)).toBeNull();
    expect(selfAnswerAskUserQuestion(undefined)).toBeNull();
    expect(selfAnswerAskUserQuestion({})).toBeNull();
    expect(selfAnswerAskUserQuestion({ questions: [] })).toBeNull();
    expect(selfAnswerAskUserQuestion({ questions: [{ question: '', options: [{ label: 'x' }] }] })).toBeNull();
    expect(selfAnswerAskUserQuestion({ questions: ['nope'] })).toBeNull();
    expect(selfAnswerAskUserQuestion({ questions: [{ question: 'q', options: 'nope' }] })).toBeNull();
  });

  it('skips options without a label rather than answering with undefined', () => {
    expect(selfAnswerAskUserQuestion({
      questions: [{ question: 'q', options: [{ description: 'no label' }] }],
    })).toBeNull();
  });
});
