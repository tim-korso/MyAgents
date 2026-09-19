import { createContext } from 'react';
import type { AsyncQuestionReply } from '../../shared/asyncUserQuestions';

/** Views derive status from accepted messages and the existing Session queue. */
export interface AsyncQuestionActions {
  answered: AsyncQuestionReply[];
  queued: AsyncQuestionReply[];
  disabled: boolean;
  onReply: (reply: AsyncQuestionReply, text: string) => Promise<boolean>;
  onCompose: (reply: AsyncQuestionReply, title: string) => void;
}

export const AsyncQuestionContext = createContext<AsyncQuestionActions | null>(null);
