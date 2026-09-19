import { describe, expect, it } from 'vitest';

import { spaceSlugCandidate } from './spaceSlug';

describe('spaceSlugCandidate', () => {
  it('keeps latin words as a hyphenated slug', () => {
    expect(spaceSlugCandidate('have a good')).toBe('have-a-good');
  });

  it('transliterates Chinese names to pinyin', () => {
    expect(spaceSlugCandidate('试一试')).toBe('shi-yi-shi');
  });

  it('normalizes mixed Chinese and latin names', () => {
    expect(spaceSlugCandidate('测试 Space')).toBe('ce-shi-space');
  });

  it('keeps the generated slug ascii-only for pinyin with umlaut vowels', () => {
    expect(spaceSlugCandidate('绿色空间')).toBe('lu-se-kong-jian');
  });

  it('falls back when the name has no slug-safe content', () => {
    expect(spaceSlugCandidate('   ---   ')).toBe('space');
  });
});
