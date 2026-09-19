import { describe, expect, it } from 'vitest';

import {
  normalizeUiLanguage,
  resolveEffectiveLocale,
  resolveSupportedLocale,
} from './i18n';

describe('shared i18n locale helpers', () => {
  it('normalizes persisted UI language values fail-closed to system', () => {
    expect(normalizeUiLanguage('system')).toBe('system');
    expect(normalizeUiLanguage('zh-CN')).toBe('zh-CN');
    expect(normalizeUiLanguage('en-US')).toBe('en-US');
    expect(normalizeUiLanguage('fr-FR')).toBe('system');
    expect(normalizeUiLanguage(null)).toBe('system');
  });

  it('maps system locales to the supported product locale set', () => {
    expect(resolveSupportedLocale('zh_CN.UTF-8')).toBe('zh-CN');
    expect(resolveSupportedLocale('zh-Hans-CN')).toBe('zh-CN');
    expect(resolveSupportedLocale('en-GB')).toBe('en-US');
    expect(resolveSupportedLocale(undefined)).toBe('en-US');
  });

  it('prefers explicit UI language over system locale', () => {
    expect(resolveEffectiveLocale('en-US', 'zh-CN')).toBe('en-US');
    expect(resolveEffectiveLocale('zh-CN', 'en-US')).toBe('zh-CN');
    expect(resolveEffectiveLocale('system', 'zh-TW')).toBe('zh-CN');
  });
});
