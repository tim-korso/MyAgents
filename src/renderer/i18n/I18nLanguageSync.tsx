import { useEffect, useMemo, useState } from 'react';

import { useConfig } from '@/hooks/useConfig';
import { isTauriEnvironment } from '@/utils/browserMock';
import { listenWithCleanup } from '@/utils/tauriListen';
import { isSupportedLocale, resolveEffectiveLocale, type SupportedLocale, type UiLanguage } from '../../shared/i18n';
import { getBrowserSystemLocale, i18n } from './index';

interface UiLanguageStatePayload {
  uiLanguage: UiLanguage;
  locale: SupportedLocale;
}

function applyDocumentLocale(locale: SupportedLocale): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
}

async function loadNativeLocale(): Promise<SupportedLocale | null> {
  if (!isTauriEnvironment()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  const payload = await invoke<UiLanguageStatePayload>('cmd_get_ui_language_state');
  return isSupportedLocale(payload.locale) ? payload.locale : null;
}

export function I18nLanguageSync() {
  const { config } = useConfig();
  const [nativeLocale, setNativeLocale] = useState<SupportedLocale | null>(null);

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    const ac = new AbortController();
    void loadNativeLocale().then(setNativeLocale).catch(err => {
      console.warn('[i18n] failed to load native language state:', err);
    });
    void listenWithCleanup<UiLanguageStatePayload>('ui-language-changed', event => {
      const locale = event.payload.locale;
      if (isSupportedLocale(locale)) {
        setNativeLocale(locale);
      }
    }, ac.signal);
    return () => ac.abort();
  }, []);

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    void loadNativeLocale().then(setNativeLocale).catch(err => {
      console.warn('[i18n] failed to refresh native language state:', err);
    });
  }, [config.uiLanguage]);

  const locale = useMemo(
    () => nativeLocale ?? resolveEffectiveLocale(config.uiLanguage, getBrowserSystemLocale()),
    [config.uiLanguage, nativeLocale],
  );

  useEffect(() => {
    applyDocumentLocale(locale);
    if (i18n.language !== locale) {
      void i18n.changeLanguage(locale);
    }
  }, [locale]);

  return null;
}
