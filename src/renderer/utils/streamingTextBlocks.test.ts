import { describe, expect, it } from 'vitest';
import { appendStreamingText, completeStreamingText } from './streamingTextBlocks';

const questions = { id: 'thread:item', questions: [{ title: '去哪？', options: ['看山', '看海'] }] };

describe('streaming text item boundaries', () => {
  it('keeps the next item separate from the last option after a text stop', () => {
    const stopped = completeStreamingText('去哪？\n- 看山\n- 看海', questions);
    expect(appendStreamingText(stopped, '接下来的正文')).toEqual([
      { type: 'text', text: '去哪？\n- 看山\n- 看海', isComplete: true, asyncQuestions: questions },
      { type: 'text', text: '接下来的正文' },
    ]);
  });
  it('keeps an explicit question with no text and does not attach it to a previous item', () => {
    const stopped = completeStreamingText('previous');
    expect(completeStreamingText(stopped, questions)).toEqual([
      { type: 'text', text: 'previous', isComplete: true },
      { type: 'text', text: '', isComplete: true, asyncQuestions: questions },
    ]);
  });
  it('still coalesces deltas inside one open item', () => {
    expect(appendStreamingText([{ type: 'text', text: 'hel' }], 'lo'))
      .toEqual([{ type: 'text', text: 'hello' }]);
    expect(appendStreamingText('hel', 'lo')).toBe('hello');
  });
});
