import { describe, expect, it } from 'vitest';
import { documentHref } from './documentLinks';
describe('document link routing', () => {
  it('resolves relative files and leaves supported external targets intact', () => {
    expect(documentHref('../other.md#L3', 'docs/sub/note.md')).toBe('docs/other.md#L3');
    expect(documentHref('./img.png', 'note.md')).toBe('img.png');
    expect(documentHref('#heading', 'docs/note.md')).toBe('#heading');
    expect(documentHref('https://example.com/a', 'docs/note.md')).toBe('https://example.com/a');
    expect(documentHref('C:\\docs\\x.md', 'docs/note.md')).toBe('C:\\docs\\x.md');
    expect(documentHref('javascript:alert(1)', 'docs/note.md')).toBeNull();
    expect(documentHref('../../outside.md', 'docs/note.md')).toBeNull();
  });
});
