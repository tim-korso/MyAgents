import { beforeEach, describe, expect, it } from 'vitest';

import { i18n } from '@/i18n';
import {
  computeMonacoFindTooltipPosition,
  normalizeMonacoFindTooltipLabel,
} from './monacoFindTooltip';

describe('monacoFindTooltip', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN');
  });

  it('localizes Monaco find widget labels while preserving keybinding suffixes', () => {
    expect(normalizeMonacoFindTooltipLabel('Close (Escape)')).toBe('关闭 (Escape)');
    expect(normalizeMonacoFindTooltipLabel('Match Case')).toBe('区分大小写');
    expect(normalizeMonacoFindTooltipLabel('  Next   Match   (⇧Enter) ')).toBe('下一个匹配 (⇧Enter)');
  });

  it('keeps tooltip horizontally inside the viewport', () => {
    expect(computeMonacoFindTooltipPosition(
      { left: 2, top: 10, bottom: 34, width: 20 },
      { width: 320, height: 240 },
    )).toEqual({ x: 138, top: 42 });

    expect(computeMonacoFindTooltipPosition(
      { left: 300, top: 10, bottom: 34, width: 20 },
      { width: 320, height: 240 },
    )).toEqual({ x: 182, top: 42 });
  });

  it('places the tooltip above only when there is not enough room below', () => {
    expect(computeMonacoFindTooltipPosition(
      { left: 120, top: 208, bottom: 232, width: 30 },
      { width: 320, height: 240 },
    )).toEqual({ x: 138, top: 168 });
  });
});
