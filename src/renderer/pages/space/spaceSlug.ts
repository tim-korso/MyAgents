import { pinyin } from 'pinyin-pro';

const SPACE_SLUG_MAX_LENGTH = 48;

export function spaceSlugCandidate(value: string): string {
  const romanized = pinyin(value.trim(), {
    toneType: 'none',
    separator: '-',
    nonZh: 'consecutive',
    v: 'u',
    traditional: true,
  });
  const slug = romanized
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SPACE_SLUG_MAX_LENGTH)
    .replace(/^-+|-+$/g, '');
  return slug || 'space';
}
