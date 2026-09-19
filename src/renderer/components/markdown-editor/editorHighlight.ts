import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import type { SyntaxStyle } from '@/theme/types';

/** Reuse the active theme's syntax palette instead of introducing a second
 * palette/setting for Markdown or fixed light-only CodeMirror token colors. */
export function editorHighlight(prism: SyntaxStyle) {
  return HighlightStyle.define([
    { tag: tags.heading, fontWeight: 'var(--font-weight-emphasis)' },
    { tag: tags.link, color: 'var(--accent)', textDecoration: 'underline' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strong, fontWeight: 'var(--font-weight-emphasis)' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    { tag: tags.meta, color: 'var(--ink-muted)' },
    { tag: tags.keyword, ...prism.keyword },
    { tag: tags.comment, ...prism.comment },
    { tag: tags.string, ...prism.string },
    { tag: tags.number, ...prism.number },
    { tag: tags.bool, ...prism.boolean },
    { tag: tags.operator, ...prism.operator },
    { tag: tags.punctuation, ...prism.punctuation },
    { tag: tags.propertyName, ...prism.property },
    { tag: tags.typeName, ...prism['class-name'] },
    { tag: tags.function(tags.variableName), ...prism.function },
  ]);
}
