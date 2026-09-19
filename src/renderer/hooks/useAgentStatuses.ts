// Hook: Poll agent statuses from Rust cmd_all_agents_status (5s interval)
import { useState, useEffect, useRef, useCallback } from 'react';
import { isTauriEnvironment } from '@/utils/browserMock';
import { listenWithCleanup } from '@/utils/tauriListen';

export interface ActiveSessionData {
  sessionKey: string;
  sessionId: string;
  sourceType: 'private' | 'group';
  sourceId?: string;
  sourceDisplayName?: string;
  lastSenderName?: string;
  workspacePath: string;
  messageCount: number;
  metadataBirthPending?: boolean;
  metadataIndexed?: boolean;
  lastActive: string;
}

interface ChannelStatusData {
  channelId: string;
  channelType: string;
  name?: string;
  status: 'online' | 'connecting' | 'error' | 'stopped';
  botUsername?: string;
  uptimeSeconds: number;
  lastMessageAt?: string;
  activeSessions: ActiveSessionData[];
  errorMessage?: string;
  restartCount: number;
  bufferedMessages: number;
  bindUrl?: string;
  bindCode?: string;
}

interface AgentStatusData {
  agentId: string;
  agentName: string;
  enabled: boolean;
  channels: ChannelStatusData[];
}

type AgentStatusMap = Record<string, AgentStatusData>;

const POLL_INTERVAL_MS = 5000;

export function useAgentStatuses(enabled = true) {
  const [statuses, setStatuses] = useState<AgentStatusMap>({});
  const [loading, setLoading] = useState(true);
  const isMountedRef = useRef(true);
  const requestSeqRef = useRef(0);
  // Keep latest fetch fn in a ref so interval always calls current version
  const fetchRef = useRef<() => void>(() => {});

  const refresh = useCallback(() => {
    fetchRef.current();
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    if (!enabled || !isTauriEnvironment()) {
      setLoading(false);
      return;
    }

    const fetchStatuses = async () => {
      const requestSeq = ++requestSeqRef.current;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const result = await invoke<AgentStatusMap>('cmd_all_agents_status');
        if (isMountedRef.current && requestSeq === requestSeqRef.current) {
          setStatuses(result);
          setLoading(false);
        }
      } catch {
        if (isMountedRef.current && requestSeq === requestSeqRef.current) {
          setLoading(false);
        }
      }
    };
    fetchRef.current = fetchStatuses;

    fetchStatuses();
    const id = setInterval(fetchStatuses, POLL_INTERVAL_MS);
    const ac = new AbortController();
    void listenWithCleanup('agent:status-changed', fetchStatuses, ac.signal);
    return () => {
      isMountedRef.current = false;
      ac.abort();
      clearInterval(id);
    };
  }, [enabled]);

  return { statuses, loading, refresh };
}

export type { AgentStatusData, ChannelStatusData, AgentStatusMap };
