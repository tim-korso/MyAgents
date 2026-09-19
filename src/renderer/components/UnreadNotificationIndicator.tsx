interface UnreadNotificationIndicatorProps {
  count: number;
  label: string;
}

export default function UnreadNotificationIndicator({
  count,
  label,
}: UnreadNotificationIndicatorProps) {
  if (count <= 0) return null;

  if (count === 1) {
    return (
      <span
        className="inline-flex shrink-0 items-center"
        aria-label={label}
        title={label}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-warm)]" aria-hidden="true" />
      </span>
    );
  }

  const displayCount = count > 99 ? '99+' : String(count);
  return (
    <span
      className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-[var(--accent-warm-subtle)] px-1 text-xs font-semibold leading-none text-[var(--accent-warm)]"
      aria-label={label}
      title={label}
    >
      {displayCount}
    </span>
  );
}
