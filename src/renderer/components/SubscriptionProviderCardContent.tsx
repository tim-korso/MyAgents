import type { ReactNode } from 'react';

interface SubscriptionProviderCardContentProps {
  description: ReactNode;
  status: ReactNode;
  actions?: ReactNode;
  error?: ReactNode;
}
/** Shared visual shell; auth state and token ownership stay provider-specific. */
export default function SubscriptionProviderCardContent({
  description,
  status,
  actions,
  error,
}: SubscriptionProviderCardContentProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--ink-muted)]">{description}</p>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">{status}</div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {error}
    </div>
  );
}
