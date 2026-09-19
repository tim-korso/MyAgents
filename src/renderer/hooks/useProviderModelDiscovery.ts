import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Provider } from '@/config/types';
import { TOKENDANCE_PROVIDER_ID } from '../../shared/tokendance';
import { fetchProviderModels, type DiscoveredModel } from '@/config/services/modelDiscoveryService';

interface DiscoveryOptions {
  provider: Provider;
  apiKey?: string;
  enabled: boolean;
  discoveryAction?: () => Promise<DiscoveredModel[]>;
  onDiscovered?: (models: DiscoveredModel[], isCurrent: () => boolean) => Promise<void>;
}

/** Component-owned catalog lifecycle. Only connection/eligibility changes
 * resubscribe; render callbacks and the configured model projection do not.
 * Native discovery is a bounded, non-cancellable command, so cleanup retires
 * result consumption. Only its pending promise is reused during effect replay;
 * settled results are never a shared cache or an automatic retry trigger.
 */
export function useProviderModelDiscovery({
  provider, apiKey, enabled, discoveryAction, onDiscovered,
}: DiscoveryOptions) {
  const { id, modelListUrl } = provider;
  const baseUrl = provider.config.baseUrl;
  const managed = discoveryAction !== undefined;
  const credential = managed || id === TOKENDANCE_PROVIDER_ID ? undefined : apiKey;
  const request = useMemo(() => ({
    provider: { id, modelListUrl, config: { baseUrl } },
    apiKey: credential,
    managed,
    enabled,
  }), [id, modelListUrl, baseUrl, credential, managed, enabled]);

  const latest = useRef({ request, discoveryAction, onDiscovered });
  latest.current = { request, discoveryAction, onDiscovered };
  const active = useRef(false);
  const generation = useRef(0);
  const pending = useRef<{
    request: typeof request;
    promise: Promise<DiscoveredModel[]>;
  } | null>(null);
  const [state, setState] = useState<{
    request: typeof request;
    models: DiscoveredModel[];
    loading: boolean;
    error: string | null;
  }>({ request, models: [], loading: enabled, error: null });

  const refresh = useCallback(async () => {
    if (!active.current || latest.current.request !== request || !request.enabled) return;
    const currentGeneration = ++generation.current;
    const isCurrent = () => active.current
      && latest.current.request === request && generation.current === currentGeneration;
    setState(previous => ({
      request,
      models: previous.request === request ? previous.models : [],
      loading: true,
      error: null,
    }));
    try {
      let flight = pending.current;
      if (flight?.request !== request) {
        const action = latest.current.discoveryAction;
        const promise = (async () => action
          ? action()
          : fetchProviderModels(request.provider, request.apiKey))();
        flight = { request, promise };
        pending.current = flight;
        const settled = () => {
          if (pending.current === flight) pending.current = null;
        };
        void promise.then(settled, settled);
      }
      const models = await flight.promise;
      if (!isCurrent()) return;
      await latest.current.onDiscovered?.(models, isCurrent);
      if (!isCurrent()) return;
      setState({ request, models, loading: false, error: null });
    } catch (error) {
      if (!isCurrent()) return;
      const message = error && typeof error === 'object' && 'message' in error
        ? error.message : error;
      setState(previous => ({
        ...previous,
        loading: false,
        error: typeof message === 'string' ? message : String(error),
      }));
    }
  }, [request]);

  useEffect(() => {
    active.current = true;
    void refresh();
    return () => {
      active.current = false;
      generation.current += 1;
    };
  }, [refresh]);

  // A changed connection must never render the previous owner's catalog,
  // including the render before the next effect has started.
  const current = state.request === request;
  return {
    models: current ? state.models : [],
    loading: current ? state.loading : enabled,
    error: current ? state.error : null,
    refresh,
  };
}
