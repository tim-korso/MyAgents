import { describe, expect, it } from 'vitest';

import { appendCronPromptToDraft } from './cronComposerRecovery';

describe('appendCronPromptToDraft', () => {
  it('uses the cron prompt as the draft when the composer is empty', () => {
    expect(appendCronPromptToDraft('', '  run heartbeat  ')).toBe('run heartbeat');
  });

  it('appends recovered cron prompt below existing draft content', () => {
    expect(appendCronPromptToDraft('manual follow-up\n', 'cron prompt')).toBe('manual follow-up\n\ncron prompt');
  });

  it('leaves the draft unchanged when the recovered prompt is empty', () => {
    expect(appendCronPromptToDraft('manual follow-up', '   ')).toBe('manual follow-up');
  });
});
