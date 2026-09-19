import { i18n } from '@/i18n';

const VIEWPORT_MARGIN = 8;
const TOOLTIP_MAX_WIDTH = 260;
const TOOLTIP_ESTIMATED_HEIGHT = 32;
const TOOLTIP_GAP = 8;

interface RectLike {
  left: number;
  top: number;
  bottom: number;
  width: number;
}

interface ViewportLike {
  width: number;
  height: number;
}

export interface MonacoFindTooltipPosition {
  x: number;
  top: number;
}

const FIND_TOOLTIP_LABELS: Array<[source: string, key: string]> = [
  ['Close', 'close'],
  ['Previous Match', 'previousMatch'],
  ['Next Match', 'nextMatch'],
  ['Match Case', 'matchCase'],
  ['Match Whole Word', 'matchWholeWord'],
  ['Use Regular Expression', 'useRegularExpression'],
  ['Find in Selection', 'findInSelection'],
  ['Toggle Replace', 'toggleReplace'],
  ['Replace All', 'replaceAll'],
  ['Replace', 'replace'],
];

export function normalizeMonacoFindTooltipLabel(label: string): string {
  const normalized = label.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';

  for (const [source, key] of FIND_TOOLTIP_LABELS) {
    const target = i18n.t(`app:monacoFind.${key}`);
    if (normalized === source) return target;
    if (normalized.startsWith(`${source} `)) {
      return `${target} ${normalized.slice(source.length).trim()}`;
    }
  }

  return normalized;
}

export function resolveMonacoFindTooltipLabel(button: HTMLElement | null): string | null {
  if (!button) return null;
  const label = normalizeMonacoFindTooltipLabel(button.getAttribute('aria-label') ?? '');
  return label || null;
}

export function closestMonacoFindButton(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const button = target.closest('.find-widget [role="button"]');
  return button instanceof HTMLElement ? button : null;
}

export function computeMonacoFindTooltipPosition(
  rect: RectLike,
  viewport: ViewportLike,
): MonacoFindTooltipPosition {
  const maxTooltipWidth = Math.min(TOOLTIP_MAX_WIDTH, Math.max(0, viewport.width - VIEWPORT_MARGIN * 2));
  const minX = VIEWPORT_MARGIN + maxTooltipWidth / 2;
  const maxX = Math.max(minX, viewport.width - maxTooltipWidth / 2 - VIEWPORT_MARGIN);
  const x = Math.max(minX, Math.min(rect.left + rect.width / 2, maxX));

  const belowTop = rect.bottom + TOOLTIP_GAP;
  const aboveTop = rect.top - TOOLTIP_ESTIMATED_HEIGHT - TOOLTIP_GAP;
  const top = belowTop + TOOLTIP_ESTIMATED_HEIGHT <= viewport.height - VIEWPORT_MARGIN
    ? belowTop
    : Math.max(VIEWPORT_MARGIN, aboveTop);

  return { x, top };
}
