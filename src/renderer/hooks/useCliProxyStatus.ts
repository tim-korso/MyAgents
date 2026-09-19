import { useCallback, useEffect, useRef, useState } from 'react';
import type { CliProxyStatus } from '../../shared/cliproxy';
import { getCliProxyStatus } from '@/config/services/cliproxyService';
import { listenWithCleanup } from '@/utils/tauriListen';
import { isLinuxDesktop } from '@/utils/desktopPlatform';

/** A settings projection only. Rust owns startup/update/account work even
 * while settings is closed; unmounting this hook never cancels that work. */
export function useCliProxyStatus() {
  const [status, setStatus] = useState<CliProxyStatus | null>(null);
  const lifecycle = useRef({ active: false, sequence: 0 });
  const refresh = useCallback(async () => {
    if (isLinuxDesktop()) return;
    const owner = lifecycle.current;
    const request = ++owner.sequence;
    try {
      const next = await getCliProxyStatus();
      if (owner.active && request === owner.sequence) setStatus(next);
    } catch { /* Keep the last product view during App startup. */ }
  }, []);
  useEffect(() => {
    if (isLinuxDesktop()) return;
    const owner = lifecycle.current;
    owner.active = true;
    const controller = new AbortController();
    void listenWithCleanup('cliproxy:changed', () => { void refresh(); }, controller.signal);
    const request = ++owner.sequence;
    void getCliProxyStatus().then(next => {
      if (owner.active && request === owner.sequence) setStatus(next);
    }, () => {});
    const timer = setInterval(() => { void refresh(); }, 2_000);
    return () => {
      owner.active = false;
      owner.sequence++;
      controller.abort();
      clearInterval(timer);
    };
  }, [refresh]);
  return { status, refresh };
}
