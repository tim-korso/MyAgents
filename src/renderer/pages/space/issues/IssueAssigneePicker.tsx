import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  spaceGetMembers,
  type SpaceIdentitySummary,
  type SpaceMember,
  type SpaceRegisteredAgent,
  type SpaceSession,
} from '@/api/spaceCloud';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Popover } from '@/components/ui/Popover';
import { SpaceIdentityLine } from '@/pages/space/SpaceAvatar';

export type AssigneeChoice = {
  id: string;
  type: 'user' | 'registered_agent';
  name: string;
  avatarUrl?: string | null;
};

function recentMemberKey(session: SpaceSession): string {
  return `myagents.space.recentAssignees:${session.space.id}:${session.user.id}`;
}

function readRecentMemberIds(session: SpaceSession): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(recentMemberKey(session)) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string').slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

function rememberMember(session: SpaceSession, userId: string): void {
  const next = [userId, ...readRecentMemberIds(session).filter((id) => id !== userId)].slice(0, 8);
  try {
    localStorage.setItem(recentMemberKey(session), JSON.stringify(next));
  } catch {
    // Recent humans are a local convenience only; assignment success must not depend on storage.
  }
}

export function IssueAssigneePicker({
  session,
  assignee,
  agents,
  onSelect,
  onCancel,
  cancelMode = 'assignment',
  humanOnly = false,
}: {
  session: SpaceSession;
  assignee?: SpaceIdentitySummary | null;
  agents: SpaceRegisteredAgent[];
  onSelect: (choice: AssigneeChoice) => Promise<void>;
  onCancel: () => Promise<void>;
  cancelMode?: 'assignment' | 'selection';
  humanOnly?: boolean;
}) {
  const { t } = useTranslation('app');
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const admin = session.membership.role === 'owner' || session.membership.role === 'admin';
  const canCancel = admin || (assignee?.type === 'user' && assignee.id === session.user.id);
  const canInteract = admin
    || !assignee
    || (assignee.type === 'user' && assignee.id === session.user.id);

  useEffect(() => {
    if (!open || !admin || members.length > 0) return;
    let cancelled = false;
    setLoadingMembers(true);
    void spaceGetMembers(session.space.id)
      .then((payload) => {
        if (!cancelled) setMembers(payload.members ?? payload.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingMembers(false);
      });
    return () => {
      cancelled = true;
    };
  }, [admin, members.length, open, session.space.id]);

  const choices = useMemo(() => {
    const agentChoices: AssigneeChoice[] = admin && !humanOnly
      ? agents
          .filter((agent) => agent.status === 'active')
          .map((agent) => ({
            id: agent.id,
            type: 'registered_agent' as const,
            name: agent.displayName,
            avatarUrl: agent.avatarUrl,
          }))
      : [];
    const memberChoices: AssigneeChoice[] = admin
      ? members.map((member) => ({
          id: member.user.id,
          type: 'user' as const,
          name: member.user.name?.trim() || member.user.email,
          avatarUrl: member.user.avatarUrl,
        }))
      : [{
          id: session.user.id,
          type: 'user' as const,
          name: session.user.name?.trim() || session.user.email,
          avatarUrl: session.user.avatarUrl,
        }];
    const needle = query.trim().toLocaleLowerCase();
    if (needle) {
      return [...agentChoices, ...memberChoices].filter((choice) =>
        `${choice.name} ${choice.id}`.toLocaleLowerCase().includes(needle),
      );
    }
    const recentIds = readRecentMemberIds(session);
    const recentMembers = recentIds
      .map((id) => memberChoices.find((choice) => choice.id === id))
      .filter((choice): choice is AssigneeChoice => Boolean(choice));
    if (!admin && recentMembers.length === 0) return memberChoices;
    return [...agentChoices, ...recentMembers];
  }, [admin, agents, humanOnly, members, query, session]);

  const select = async (choice: AssigneeChoice) => {
    const key = `${choice.type}:${choice.id}`;
    setBusyKey(key);
    try {
      await onSelect(choice);
      if (choice.type === 'user') rememberMember(session, choice.id);
      setOpen(false);
      setQuery('');
    } catch {
      return;
    } finally {
      setBusyKey(null);
    }
  };

  const cancelAssignment = async () => {
    setBusyKey('cancel');
    try {
      await onCancel();
      setConfirmCancel(false);
      setOpen(false);
    } catch {
      return;
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <span className="inline-flex min-w-0">
      <button
        ref={triggerRef}
        type="button"
        disabled={!canInteract}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-w-0 items-center rounded-md px-1.5 py-1 text-sm font-medium text-[var(--ink)] transition-colors hover:bg-[var(--paper-inset)] active:scale-[0.98] disabled:pointer-events-none"
        aria-expanded={open}
      >
        {assignee ? (
          <>
            <SpaceIdentityLine
              name={assignee.name ?? assignee.id}
              avatarUrl={assignee.avatarUrl}
              type={assignee.type ?? 'user'}
              avatarSize={20}
              nameClassName="font-medium text-[var(--ink)]"
            />
            {assignee.type === 'registered_agent' && (
              <span className="ml-1.5 rounded-md bg-[var(--paper-inset)] px-1.5 py-0.5 text-xs font-medium text-[var(--ink-muted)]">Agent</span>
            )}
          </>
        ) : (
          <span className="text-[var(--ink-muted)]">{t('space.detail.unassigned')}</span>
        )}
      </button>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        offset={8}
        className="w-80 rounded-xl p-2"
      >
          <label className="flex h-9 items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-[var(--ink-muted)]" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-w-0 flex-1 border-0 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)]"
              placeholder={t('space.detail.assigneeSearch')}
            />
          </label>

          {assignee && (
            <div className="mt-2 border-b border-[var(--line-subtle)] pb-2">
              <div className="px-2 pb-1 text-xs font-medium text-[var(--ink-subtle)]">{t('space.detail.currentAssignee')}</div>
              <div className="flex h-9 items-center justify-between gap-2 rounded-lg bg-[var(--paper-inset)] px-2">
                <span className="inline-flex min-w-0 items-center">
                  <SpaceIdentityLine
                    name={assignee.name ?? assignee.id}
                    avatarUrl={assignee.avatarUrl}
                    type={assignee.type ?? 'user'}
                    avatarSize={20}
                    nameClassName="font-medium text-[var(--ink)]"
                  />
                  {assignee.type === 'registered_agent' && (
                    <span className="ml-1.5 rounded-md bg-[var(--paper-elevated)] px-1.5 py-0.5 text-xs font-medium text-[var(--ink-muted)]">Agent</span>
                  )}
                </span>
                {canCancel && (
                  <button
                    type="button"
                    onClick={() => {
                      if (cancelMode === 'selection') {
                        void cancelAssignment();
                      } else {
                        setConfirmCancel(true);
                      }
                    }}
                    className="grid h-7 w-7 place-items-center rounded-md text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-elevated)] hover:text-[var(--error)]"
                    aria-label={t('space.detail.cancelAssignee')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="mt-2 max-h-64 overflow-y-auto">
            {loadingMembers && choices.length === 0 ? (
              <div className="flex h-12 items-center justify-center text-xs text-[var(--ink-muted)]">
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                {t('space.detail.loadingAssignees')}
              </div>
            ) : choices.length === 0 ? (
              <div className="px-2 py-4 text-center text-xs text-[var(--ink-muted)]">{t('space.detail.noAssignees')}</div>
            ) : (
              choices.map((choice) => {
                const key = `${choice.type}:${choice.id}`;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={busyKey !== null}
                    onClick={() => void select(choice)}
                    className="flex h-10 w-full items-center justify-between gap-2 rounded-lg px-2 text-left transition-colors hover:bg-[var(--paper-inset)] active:scale-[0.99] disabled:opacity-60"
                  >
                    <SpaceIdentityLine
                      name={choice.name}
                      avatarUrl={choice.avatarUrl}
                      type={choice.type}
                      avatarSize={22}
                      nameClassName="font-medium text-[var(--ink)]"
                    />
                    <span className="flex shrink-0 items-center gap-2">
                      {choice.type === 'registered_agent' && (
                        <span className="rounded-md bg-[var(--paper-inset)] px-1.5 py-0.5 text-xs font-medium text-[var(--ink-muted)]">Agent</span>
                      )}
                      {busyKey === key && <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ink-muted)]" />}
                    </span>
                  </button>
                );
              })
            )}
          </div>
      </Popover>

      {confirmCancel && (
        <ConfirmDialog
          title={t(cancelMode === 'selection' ? 'space.detail.clearAssigneeTitle' : 'space.detail.cancelAssigneeTitle')}
          message={t(cancelMode === 'selection' ? 'space.detail.clearAssigneeMessage' : 'space.detail.cancelAssigneeMessage')}
          confirmText={t(cancelMode === 'selection' ? 'space.detail.clearAssigneeConfirm' : 'space.detail.cancelAssigneeConfirm')}
          confirmVariant="danger"
          loading={busyKey === 'cancel'}
          onConfirm={() => void cancelAssignment()}
          onCancel={() => setConfirmCancel(false)}
        />
      )}
    </span>
  );
}
