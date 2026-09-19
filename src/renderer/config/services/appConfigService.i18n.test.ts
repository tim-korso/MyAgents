import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, type AppConfig } from '../types';
import { migrateUiLanguageField } from './appConfigService';

describe('appConfigService uiLanguage migration', () => {
  it('keeps existing pre-i18n configs on Chinese when the field is missing', () => {
    const loaded = { ...DEFAULT_CONFIG } as AppConfig;
    delete loaded.uiLanguage;

    expect(migrateUiLanguageField(loaded).uiLanguage).toBe('zh-CN');
  });

  it('normalizes invalid persisted values to system', () => {
    const loaded = { ...DEFAULT_CONFIG, uiLanguage: 'fr-FR' as AppConfig['uiLanguage'] };

    expect(migrateUiLanguageField(loaded).uiLanguage).toBe('system');
  });
});
