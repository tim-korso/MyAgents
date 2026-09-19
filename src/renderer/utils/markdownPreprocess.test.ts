import { describe, expect, test } from 'vitest';

import { preprocessMarkdownContent } from './markdownPreprocess';

describe('preprocessMarkdownContent', () => {
  test('keeps C# language names inline instead of rewriting them as headings', () => {
    const input = '补充一下是： C# WPF + WebView2 架构';

    expect(preprocessMarkdownContent(input)).toBe(input);
  });

  test('keeps F# language names inline instead of rewriting them as headings', () => {
    const input = 'Use F# for this example';

    expect(preprocessMarkdownContent(input)).toBe(input);
  });

  test('still separates headings when marker is not attached to a word token', () => {
    expect(preprocessMarkdownContent('结果：# 标题')).toBe('结果：\n\n# 标题');
  });

  // `#text` (no space) is NOT a heading per CommonMark — we used to auto-insert
  // the space, but that couldn't distinguish a heading from a tag / issue
  // reference (`#210`, `#heihei`, `#标题`), all of which got rewritten into an
  // `<h1>` and infected the rest of the line. Rule was removed; everything
  // here should pass through untouched.
  test('leaves #<text> at line start as plain text (no heading rewrite)', () => {
    expect(preprocessMarkdownContent('#210 现在去 issue 里问。')).toBe('#210 现在去 issue 里问。');
    expect(preprocessMarkdownContent('#212：没修改')).toBe('#212：没修改');
    expect(preprocessMarkdownContent('#heihei asdfasf')).toBe('#heihei asdfasf');
    expect(preprocessMarkdownContent('#标题')).toBe('#标题');
    expect(preprocessMarkdownContent('##Title')).toBe('##Title');
  });

  // Version numbers, dates, and IPs at line start MUST NOT get rewritten into
  // ordered lists. `0.2.18` → `0. 2.18` would render "2.18" as an ordered-list
  // item and swallow the rest of the line.
  test('leaves numeric.dot tokens at line start as plain text', () => {
    expect(preprocessMarkdownContent('0.2.18 修了 markdown bug')).toBe('0.2.18 修了 markdown bug');
    expect(preprocessMarkdownContent('2026.5.18 是个好日子')).toBe('2026.5.18 是个好日子');
    expect(preprocessMarkdownContent('192.168.1.1 gateway')).toBe('192.168.1.1 gateway');
  });

  test('still adds space for real ordered-list-style "N.token"', () => {
    expect(preprocessMarkdownContent('1.item')).toBe('1. item');
    expect(preprocessMarkdownContent('3.步骤')).toBe('3. 步骤');
  });

  // Negative-leading values at line start MUST NOT get rewritten into unordered
  // list items.
  test('leaves negative-leading values at line start as plain text', () => {
    expect(preprocessMarkdownContent('-50% 下降')).toBe('-50% 下降');
    expect(preprocessMarkdownContent('-5°C')).toBe('-5°C');
  });

  test('still adds space for real unordered-list-style "-token"', () => {
    expect(preprocessMarkdownContent('-item')).toBe('- item');
    expect(preprocessMarkdownContent('-步骤')).toBe('- 步骤');
  });

  // Issue #167 — Chinese-tuned models (DeepSeek, MiniMax, …) emit full-width
  // punctuation U+FF0A `＊` in place of ASCII `*`, so bold rendered as literal
  // ＊＊P1＊＊ instead of <strong>P1</strong>. Normalize paired patterns only.
  describe('full-width markdown markers (issue #167)', () => {
    test('converts paired full-width asterisks to ASCII bold', () => {
      expect(preprocessMarkdownContent('看 ＊＊P1＊＊ 这里')).toBe('看 **P1** 这里');
    });

    test('converts paired full-width asterisks for italic', () => {
      expect(preprocessMarkdownContent('看 ＊P1＊ 这里')).toBe('看 *P1* 这里');
    });

    test('converts full-width underscore bold', () => {
      expect(preprocessMarkdownContent('see ＿＿bold＿＿ here')).toBe('see __bold__ here');
    });

    test('converts full-width tilde strikethrough', () => {
      expect(preprocessMarkdownContent('～～gone～～')).toBe('~~gone~~');
    });

    test('handles multiple bold patterns inline (table-row style)', () => {
      const input = '| ＊＊P1＊＊ | 框架 | ＊＊P2＊＊ | 鸟瞰 |';
      const expected = '| **P1** | 框架 | **P2** | 鸟瞰 |';
      expect(preprocessMarkdownContent(input)).toBe(expected);
    });

    test('leaves unpaired full-width asterisks alone (legitimate text)', () => {
      // A name with a single ＊ for redaction should not be mangled
      expect(preprocessMarkdownContent('张＊三')).toBe('张＊三');
    });

    test('does not convert inside protected code blocks', () => {
      const input = '```\n＊＊not bold＊＊\n```';
      expect(preprocessMarkdownContent(input)).toBe(input);
    });

    test('does not convert inside protected inline code', () => {
      const input = '`＊＊not bold＊＊`';
      expect(preprocessMarkdownContent(input)).toBe(input);
    });
  });
});
