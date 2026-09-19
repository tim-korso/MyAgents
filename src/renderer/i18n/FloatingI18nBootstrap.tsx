import { useEffect, useState, type ReactNode } from 'react';

import { CONFIG_CHANGED_EVENT, loadAppConfig } from '@/config/services/appConfigService';
import { isTauriEnvironment } from '@/utils/browserMock';
import { listenWithCleanup } from '@/utils/tauriListen';
import { isSupportedLocale, resolveEffectiveLocale, type SupportedLocale, type UiLanguage } from '../../shared/i18n';
import { getBrowserSystemLocale, i18n } from './index';

interface UiLanguageChangedPayload {
  uiLanguage: UiLanguage;
  locale: SupportedLocale;
}

function applyLocale(locale: SupportedLocale): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
  }
  if (i18n.language !== locale) {
    void i18n.changeLanguage(locale);
  }
}

async function refreshFromDisk(): Promise<void> {
  const config = await loadAppConfig();
  applyLocale(resolveEffectiveLocale(config.uiLanguage, getBrowserSystemLocale()));
}

async function refreshFromNative(): Promise<void> {
  if (!isTauriEnvironment()) {
    await refreshFromDisk();
    return;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  const payload = await invoke<UiLanguageChangedPayload>('cmd_get_ui_language_state');
  if (isSupportedLocale(payload.locale)) {
    applyLocale(payload.locale);
  }
}

export function FloatingI18nBootstrap({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void refreshFromNative().finally(() => setReady(true));
    const ac = new AbortController();

    void listenWithCleanup<UiLanguageChangedPayload>('ui-language-changed', event => {
      applyLocale(event.payload.locale);
    }, ac.signal);

    const handleConfigChanged = () => {
      void refreshFromDisk();
    };
    window.addEventListener(CONFIG_CHANGED_EVENT, handleConfigChanged);

    return () => {
      ac.abort();
      window.removeEventListener(CONFIG_CHANGED_EVENT, handleConfigChanged);
    };
  }, []);

  return ready ? <>{children}</> : null;
}
