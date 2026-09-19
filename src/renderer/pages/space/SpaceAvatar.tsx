import { useRef, useState } from 'react';
import { Bot, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Popover } from '../../components/ui/Popover';

type IdentityInput = {
  name?: string | null;
  email?: string | null;
  id?: string | null;
};

export function spaceDisplayName(identity: IdentityInput | null | undefined): string {
  const name = identity?.name?.trim();
  if (name) return name;
  const email = identity?.email?.trim();
  if (email) return email.split('@')[0] || email;
  return identity?.id?.trim() || 'User';
}

function initialFor(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || 'U';
}

export function SpaceAvatar({
  name,
  email,
  avatarUrl,
  size = 24,
  type = 'user',
  shape = 'circle',
  className = '',
}: {
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  size?: number;
  type?: 'user' | 'registered_agent' | 'system';
  shape?: 'circle' | 'app-icon';
  className?: string;
}) {
  const displayName = spaceDisplayName({ name, email });
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const style = { width: size, height: size };
  const radiusClass = shape === 'app-icon' ? 'rounded-[22%]' : 'rounded-full';
  const fallbackTextClass = size >= 48 ? 'text-base' : size >= 32 ? 'text-sm' : 'text-xs';
  if (avatarUrl && failedUrl !== avatarUrl) {
    return (
      <span className={`inline-grid shrink-0 place-items-center overflow-hidden ${radiusClass} bg-[var(--paper-inset)] ${className}`} style={style}>
        <img
          src={avatarUrl}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
          onError={() => setFailedUrl(avatarUrl)}
        />
      </span>
    );
  }

  return (
    <span className={`inline-grid shrink-0 place-items-center ${radiusClass} border border-[var(--line-subtle)] bg-[var(--paper-inset)] ${fallbackTextClass} font-semibold leading-none text-[var(--ink-muted)] ${className}`} style={style}>
      {type === 'registered_agent' ? (
        <Bot className="h-3.5 w-3.5" />
      ) : type === 'system' ? (
        <User className="h-3.5 w-3.5" />
      ) : (
        <span>{initialFor(displayName)}</span>
      )}
    </span>
  );
}

export function SpaceIcon({
  name,
  avatarUrl,
  size = 24,
  className = '',
}: {
  name?: string | null;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
}) {
  return (
    <SpaceAvatar
      name={name}
      avatarUrl={avatarUrl}
      size={size}
      shape="app-icon"
      className={className}
    />
  );
}

export function SpaceIdentityLine({
  name,
  email,
  avatarUrl,
  type = 'user',
  avatarSize = 22,
  className = '',
  nameClassName = '',
  showAgentTag = false,
  agentOwnerName,
}: {
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  type?: 'user' | 'registered_agent' | 'system';
  avatarSize?: number;
  className?: string;
  nameClassName?: string;
  showAgentTag?: boolean;
  agentOwnerName?: string | null;
}) {
  const label = spaceDisplayName({ name, email });
  const { t } = useTranslation('app');
  const [ownerTipOpen, setOwnerTipOpen] = useState(false);
  const ownerTagRef = useRef<HTMLButtonElement | null>(null);
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 align-middle leading-none ${className}`}>
      <SpaceAvatar name={name} email={email} avatarUrl={avatarUrl} type={type} size={avatarSize} />
      <span className={`min-w-0 truncate leading-none ${nameClassName}`}>{label}</span>
      {showAgentTag && type === 'registered_agent' && (
        <span className="inline-flex shrink-0">
          <button
            ref={ownerTagRef}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setOwnerTipOpen((value) => !value);
            }}
            className="rounded-md bg-[var(--paper-inset)] px-1.5 py-0.5 text-xs font-medium leading-none text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
          >
            Agent
          </button>
          <Popover
            open={ownerTipOpen}
            onClose={() => setOwnerTipOpen(false)}
            anchorRef={ownerTagRef}
            placement="bottom"
            offset={8}
            className="max-w-64 px-2.5 py-2 text-xs font-normal leading-5 text-[var(--ink-secondary)]"
          >
            {t('space.detail.agentOwner', { name: agentOwnerName || '—' })}
          </Popover>
        </span>
      )}
    </span>
  );
}
