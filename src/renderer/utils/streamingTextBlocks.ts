import type { ContentBlock } from '@/types/chat';
import type { AsyncQuestionSet } from '../../shared/asyncUserQuestions';

export function appendStreamingText(content: string | ContentBlock[], text: string): string | ContentBlock[] {
  if (typeof content === 'string') return content + text;
  const last = content.at(-1);
  if (last?.type === 'text' && !last.isComplete && !last.asyncQuestions) return [...content.slice(0, -1), { ...last, text: (last.text ?? '') + text }];
  return [...content, { type: 'text', text }];
}

export function completeStreamingText(content: string | ContentBlock[], questions?: AsyncQuestionSet): ContentBlock[] {
  const blocks: ContentBlock[] = typeof content === 'string'
    ? (content ? [{ type: 'text', text: content }] : [])
    : content;
  const last = blocks.at(-1);
  if (last?.type === 'text' && (!last.isComplete || (questions && last.asyncQuestions?.id === questions.id))) {
    return [...blocks.slice(0, -1), { ...last, isComplete: true, ...(questions ? { asyncQuestions: questions } : {}) }];
  }
  return questions ? [...blocks, { type: 'text', text: '', isComplete: true, asyncQuestions: questions }] : blocks;
}
