import { describe, expect, test } from 'vitest';

import { hasWidgetTags, parseWidgetTags } from './widgetTagParser';

describe('widget tag false-positive guards', () => {
  // Repro of image 2 bug: literal `<generative-ui-widget>` in inline code
  // used to be matched as a real opening tag, swallowing the rest of the
  // message as an unclosed widget.
  test('inline code mentioning the tag is not parsed as a widget', () => {
    const input =
      '5. **零 wire 协议变更** —— `<generative-ui-widget>` 标签格式不变\n\n## 需要权衡的风险';

    expect(hasWidgetTags(input)).toBe(false);
    expect(parseWidgetTags(input)).toEqual([{ type: 'text', content: input }]);
  });

  // Repro of image 1 bug: mid-line mention inside a blockquote also
  // swallowed everything after.
  test('mid-line mention inside a blockquote is not parsed as a widget', () => {
    const input = [
      '> Load the design guidelines for creating interactive visual widgets.',
      '> You MUST call this before outputting any <generative-ui-widget> tags.',
      '> ...',
      '',
      '只描述了 "是什么 + 怎么调"',
    ].join('\n');

    expect(hasWidgetTags(input)).toBe(false);
    expect(parseWidgetTags(input)).toEqual([{ type: 'text', content: input }]);
  });

  test('tag inside a fenced code block is not parsed as a widget', () => {
    const input = [
      'Example:',
      '```',
      '<generative-ui-widget>',
      'something',
      '</generative-ui-widget>',
      '```',
      'after',
    ].join('\n');

    expect(hasWidgetTags(input)).toBe(false);
  });

  test('real widget at line start is still parsed', () => {
    const input = [
      'Intro text.',
      '',
      '<generative-ui-widget title="demo">',
      '<div>hi</div>',
      '</generative-ui-widget>',
      '',
      'Outro text.',
    ].join('\n');

    expect(hasWidgetTags(input)).toBe(true);
    const segs = parseWidgetTags(input);
    expect(segs).toHaveLength(3);
    expect(segs[0]).toEqual({ type: 'text', content: 'Intro text.\n\n' });
    expect(segs[1]).toMatchObject({
      type: 'widget',
      title: 'demo',
      isComplete: true,
    });
    expect(segs[2]).toEqual({ type: 'text', content: '\n\nOutro text.' });
  });

  test('real widget with leading indent is still parsed', () => {
    const input = '  <generative-ui-widget>\nhtml\n</generative-ui-widget>';
    expect(hasWidgetTags(input)).toBe(true);
    const segs = parseWidgetTags(input);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ type: 'widget', isComplete: true });
  });

  test('partial (streaming) widget at line start still flagged incomplete', () => {
    const input = 'Intro\n\n<generative-ui-widget>\n<div>partial';
    const segs = parseWidgetTags(input);
    expect(segs).toHaveLength(2);
    expect(segs[1]).toMatchObject({ type: 'widget', isComplete: false });
  });

  // Regression guard: when ≥2 widgets close in one message, the masked-region
  // window must stay aligned with the remaining-text window. A pre-existing
  // off-by-base slice (`maskedRemaining = masked.slice(...)` instead of
  // `maskedRemaining.slice(...)`) drifts the mask after iteration 2 and lets
  // a later inline-code mention escape masking and get parsed as a widget.
  test('two real widgets followed by an inline-code mention all parse correctly', () => {
    const input = [
      '<generative-ui-widget title="a">',
      'A',
      '</generative-ui-widget>',
      '',
      'mid',
      '',
      '<generative-ui-widget title="b">',
      'B',
      '</generative-ui-widget>',
      '',
      'After `<generative-ui-widget>` mention.',
    ].join('\n');

    const segs = parseWidgetTags(input);
    expect(segs.map((s) => s.type)).toEqual(['widget', 'text', 'widget', 'text']);
    expect(segs[0]).toMatchObject({ type: 'widget', title: 'a', isComplete: true });
    expect(segs[2]).toMatchObject({ type: 'widget', title: 'b', isComplete: true });
    expect((segs[3] as { type: 'text'; content: string }).content).toContain(
      'After `<generative-ui-widget>` mention.'
    );
  });

  test('double-backtick inline span mentioning the tag is not parsed as a widget', () => {
    const input = 'See ``<generative-ui-widget>`` for the literal tag.';
    expect(hasWidgetTags(input)).toBe(false);
    expect(parseWidgetTags(input)).toEqual([{ type: 'text', content: input }]);
  });

  // issue #221: weaker / non-Claude models don't always honor the "tag on its
  // own line" contract. A self-contained CLOSED widget emitted mid-line must
  // still render — otherwise the whole message degrades to Markdown, which
  // sanitizes away <style>/<canvas>/<svg> and leaves a blank gap.
  test('mid-line closed widget (no leading newline) is still parsed', () => {
    const input = '数据：<generative-ui-widget title="m"><div>x</div></generative-ui-widget> 完成';
    expect(hasWidgetTags(input)).toBe(true);
    const segs = parseWidgetTags(input);
    expect(segs.map((s) => s.type)).toEqual(['text', 'widget', 'text']);
    expect(segs[1]).toMatchObject({ type: 'widget', title: 'm', isComplete: true });
    expect(segs[1]).toMatchObject({ code: '<div>x</div>' });
    expect((segs[0] as { content: string }).content).toBe('数据：');
  });

  test('mid-line bare mention with no closing tag is still treated as text', () => {
    const input = 'You can use <generative-ui-widget> somewhere in your reply.';
    expect(hasWidgetTags(input)).toBe(false);
    expect(parseWidgetTags(input)).toEqual([{ type: 'text', content: input }]);
  });

  // Regression guard (independent-review finding): prose explaining the widget
  // syntax mentions BOTH tag strings on one line. The "mid-line closed widget"
  // relaxation must NOT treat the span between them as a widget body.
  test('prose mentioning both open and close tag strings mid-line stays text', () => {
    const en = 'It wraps content between <generative-ui-widget> and </generative-ui-widget>, then renders.';
    expect(hasWidgetTags(en)).toBe(false);
    expect(parseWidgetTags(en)).toEqual([{ type: 'text', content: en }]);

    const zh = '先输出 <generative-ui-widget> 标签，最后用 </generative-ui-widget> 结束即可。';
    expect(hasWidgetTags(zh)).toBe(false);
    expect(parseWidgetTags(zh)).toEqual([{ type: 'text', content: zh }]);
  });

  test('mid-line open whose only closing tag is inside inline code stays text', () => {
    const input = 'Open with <generative-ui-widget> then close with `</generative-ui-widget>`.';
    expect(hasWidgetTags(input)).toBe(false);
    expect(parseWidgetTags(input)).toEqual([{ type: 'text', content: input }]);
  });

  // Mid-line acceptance requires the body to open with a real element tag, so a
  // body that starts with an HTML comment (or other non-element) stays prose.
  test('mid-line tag whose body opens with an HTML comment stays text', () => {
    const input = 'see <generative-ui-widget><!-- note -->x</generative-ui-widget> here';
    expect(hasWidgetTags(input)).toBe(false);
    expect(parseWidgetTags(input)).toEqual([{ type: 'text', content: input }]);
  });

  test('mid-line bare mention before a real line-start widget does not swallow it', () => {
    const input = [
      'Mentioning <generative-ui-widget> inline here.',
      '',
      '<generative-ui-widget title="real">',
      '<div>hi</div>',
      '</generative-ui-widget>',
    ].join('\n');
    const segs = parseWidgetTags(input);
    expect(segs.map((s) => s.type)).toEqual(['text', 'widget']);
    expect(segs[1]).toMatchObject({ type: 'widget', title: 'real', isComplete: true });
    expect((segs[0] as { content: string }).content).toContain('Mentioning <generative-ui-widget> inline here.');
  });

  // Regression: a line-start widget whose JS/HTML body contains the literal
  // string `<generative-ui-widget>` (outside any code fence — widget bodies are
  // raw HTML/JS, not markdown, so they are NOT masked) used to mis-bound the
  // close search on that literal, miss the real close, and report the whole
  // widget as `isComplete:false`, swallowing everything after it.
  test('line-start widget whose body contains a literal open-tag string still completes', () => {
    const input = [
      '<generative-ui-widget title="x">',
      '<script>const tag = "<generative-ui-widget>"; document.body.dataset.t = tag;</script>',
      '</generative-ui-widget>',
      '',
      'Trailing prose.',
    ].join('\n');
    const segs = parseWidgetTags(input);
    expect(segs.map((s) => s.type)).toEqual(['widget', 'text']);
    expect(segs[0]).toMatchObject({ type: 'widget', title: 'x', isComplete: true });
    expect((segs[1] as { content: string }).content).toContain('Trailing prose.');
  });
});
