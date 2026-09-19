import { restoreAsyncQuestionAnswerDraft } from './asyncUserQuestions';
import { describe, expect, it } from 'vitest';
import { asyncQuestionSetsInContent, isAsyncQuestionReply, parseAsyncQuestionSet } from './asyncUserQuestions';

describe('explicit async question metadata', () => {
  it('retains choices/free text in persisted blocks, without guessing from legacy Markdown', () => {
    const set = { id: 'thread::item', questions: [{ title: '去哪？', options: ['看海'] }, { title: '备注？', options: null }] };
    expect(asyncQuestionSetsInContent(JSON.stringify([{ type: 'text', text: '', asyncQuestions: set }]))).toEqual([set]);
    expect(asyncQuestionSetsInContent('去哪？\n1. 看海')).toEqual([]);
    expect(asyncQuestionSetsInContent([{ type: 'tool_use', asyncQuestions: set }])).toEqual([]);
  });
  it.each([undefined, { id: '', questions: [] }, { id: 'x', questions: [{ title: 'q', options: [3] }] }, { id: 'x', questions: [{ title: ' ', options: null }] }])('rejects invalid structured metadata %j', value => {
    expect(parseAsyncQuestionSet(value)).toBeUndefined();
  });
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN])('rejects invalid question index %s', questionIndex => {
    expect(isAsyncQuestionReply({ questionId: 'q', questionIndex })).toBe(false);
  });
});

describe('cancelled async answer draft', () => {
  const reply = { questionId: 'thread::question', questionIndex: 0 };
  const content = [{ type: 'text', asyncQuestions: { id: reply.questionId, questions: [{ title: 'Where?', options: null }] } }];
  it('restores correlation and strips only the known generated prefix before resending', () => {
    const restored = restoreAsyncQuestionAnswerDraft(reply, 'Where?\n\nBeach', [JSON.stringify(content)]);
    expect(restored).toEqual({ reply, title: 'Where?', text: 'Beach' });
    expect(`${restored.title}\n\n${restored.text}`).toBe('Where?\n\nBeach');
  });
  it('preserves correlation and full text when the source is outside loaded history', () => {
    expect(restoreAsyncQuestionAnswerDraft(reply, 'Where?\n\nBeach', [])).toEqual({ reply, title: '', text: 'Where?\n\nBeach' });
    expect(restoreAsyncQuestionAnswerDraft(reply, 'Beach', [content]).text).toBe('Beach');
  });
});
