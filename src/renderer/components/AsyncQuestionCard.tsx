import { useContext, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Markdown from '@/components/Markdown';
import { AsyncQuestionContext } from '@/context/AsyncQuestionContext';
import { sameAsyncQuestionReply, type AsyncQuestionReply, type AsyncQuestionSet } from '../../shared/asyncUserQuestions';

function Question({ reply, question }: { reply: AsyncQuestionReply; question: AsyncQuestionSet['questions'][number] }) {
  const { t } = useTranslation('chat');
  const actions = useContext(AsyncQuestionContext);
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const answered = actions?.answered.some(item => sameAsyncQuestionReply(item, reply)) ?? false;
  const queued = actions?.queued.some(item => sameAsyncQuestionReply(item, reply)) ?? false;
  const disabled = !actions || actions.disabled || answered || queued || submitting;

  const send = async (answer: string) => {
    if (disabled || submittingRef.current || !actions) return;
    submittingRef.current = true;
    setSubmitting(true);
    setFailed(false);
    try {
      setFailed(!await actions.onReply(reply, `${question.title}\n\n${answer}`));
    } catch {
      setFailed(true);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <fieldset className="min-w-0 space-y-3 rounded-xl border border-[var(--line)] bg-[var(--bg-surface)] p-4" disabled={disabled}>
      <div className="ai-message-content text-[var(--ink)]"><Markdown>{question.title}</Markdown></div>
      <div className="flex flex-wrap gap-2">
        {question.options?.map((option, index) => (
          <button key={index} type="button" onClick={() => void send(option)}
            className="rounded-lg border border-[var(--line)] px-3 py-2 text-left text-sm text-[var(--ink)] hover:bg-[var(--hover-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-default disabled:opacity-50">
            {option}
          </button>
        ))}
        <button type="button" onClick={() => actions?.onCompose(reply, question.title)}
          className="rounded-lg px-3 py-2 text-sm text-[var(--accent)] hover:bg-[var(--hover-bg)] disabled:cursor-default disabled:opacity-50">
          {t('asyncQuestion.compose')}
        </button>
      </div>
      <div role="status" className="text-xs text-[var(--ink-muted)]">
        {answered ? t('asyncQuestion.answered') : queued ? t('asyncQuestion.queued') : submitting ? t('asyncQuestion.sending') : failed ? t('asyncQuestion.failed') : null}
      </div>
    </fieldset>
  );
}

export default function AsyncQuestionCard({ questions }: { questions: AsyncQuestionSet }) {
  return <div className="w-full space-y-3 py-2">
    {questions.questions.map((question, index) => <Question key={`${questions.id}:${index}`} reply={{ questionId: questions.id, questionIndex: index }} question={question} />)}
  </div>;
}

export function AsyncQuestionComposerTarget({ title, onCancel }: { title: string; onCancel: () => void }) {
  const { t } = useTranslation('chat');
  return <div className="flex min-w-0 items-center gap-2 px-3 py-2 text-xs text-[var(--ink-muted)]">
    <span className="min-w-0 flex-1 truncate" title={title}>{t('asyncQuestion.replyingTo', { title })}</span>
    <button type="button" className="shrink-0 text-[var(--accent)]" onClick={onCancel}>{t('asyncQuestion.cancel')}</button>
  </div>;
}
