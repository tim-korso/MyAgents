import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { describe, expect, it } from 'vitest';

import {
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS_DEFAULT,
  MARKDOWN_URL_TRANSFORM,
} from './markdownPipeline';

function renderMarkdown(markdown: string): string {
  return renderToStaticMarkup(
    React.createElement(
      ReactMarkdown,
      {
        remarkPlugins: MARKDOWN_REMARK_PLUGINS_DEFAULT,
        rehypePlugins: MARKDOWN_REHYPE_PLUGINS,
        urlTransform: MARKDOWN_URL_TRANSFORM,
      },
      markdown,
    ),
  );
}

describe('markdownPipeline sanitization', () => {
  it.each([
    ['file:///Users/demo/a%20b.png', 'file:///Users/demo/a%20b.png'],
    ['FiLe:///Users/demo/a.png', 'file:///Users/demo/a.png'],
    ['C:/Users/demo/a.png', 'file:///C:/Users/demo/a.png'],
    [String.raw`C:\Users\demo\a.png`, 'file:///C:/Users/demo/a.png'],
    ['file://server/share/a.png', 'file://server/share/a.png'],
  ])('preserves supported local addresses in both Markdown and HTML: %s', (href, expected) => {
    const markdown = `[file](${href.replace(/\\/g, '\\\\')})\n\n![image](${href.replace(/\\/g, '\\\\')})`;
    const raw = `<a href="${href}" onclick="alert(1)">file</a><img src="${href}" onerror="alert(1)">`;
    for (const source of [markdown, raw]) {
      const html = renderMarkdown(source);
      expect(html).toContain(`href="${expected}"`);
      expect(html).toContain(`src="${expected}"`);
      expect(html).not.toMatch(/onerror|onclick/);
    }
  });

  it.each(['javascript:alert(1)', 'vbscript:msgbox(1)', 'data:image/svg+xml,test', 'blob:https://example.com/id', 'file:///bad%ZZ.png', 'c:relative.png', 'file://user:pass@host/share/a.png'])('rejects unsupported or malformed addresses: %s', href => {
    const html = renderMarkdown(`<a href="${href}">file</a><img src="${href}">`);
    expect(html).not.toMatch(/(?:href|src)="[^"]+/);
  });
  it('strips raw HTML classes and inline styles that can escape the message bounds', () => {
    const html = renderMarkdown([
      '<div class="fixed inset-0 z-[9999] bg-black/50" style="position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,.5)">遮罩</div>',
      '<span class="fixed inset-0 bg-black/50" style="position: fixed; inset: 0">span</span>',
    ].join('\n'));

    expect(html).toContain('<div');
    expect(html).toContain('遮罩');
    expect(html).toContain('<span>span</span>');
    expect(html).not.toContain('class=');
    expect(html).not.toContain('style=');
    expect(html).not.toContain('fixed');
    expect(html).not.toContain('inset-0');
    expect(html).not.toContain('z-[9999]');
    expect(html).not.toContain('position:fixed');
  });

  it('keeps safe semantic raw HTML tags', () => {
    const html = renderMarkdown('H<sub>2</sub>O + x<sup>2</sup> <mark>ok</mark>');

    expect(html).toContain('H<sub>2</sub>O');
    expect(html).toContain('x<sup>2</sup>');
    expect(html).toContain('<mark>ok</mark>');
  });

  it('keeps fenced HTML as escaped code instead of live DOM', () => {
    const html = renderMarkdown('```tsx\n<div className="fixed inset-0">x</div>\n```');

    expect(html).toContain('<pre>');
    expect(html).toContain('<code class="language-tsx">');
    expect(html).toContain('&lt;div className=&quot;fixed inset-0&quot;&gt;x&lt;/div&gt;');
    expect(html).not.toContain('<div class="fixed');
  });

  it('keeps KaTeX-generated classes because math rendering runs after sanitize', () => {
    const html = renderMarkdown('$x$');

    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-mathml"');
    expect(html).toContain('class="katex-html"');
  });
});
