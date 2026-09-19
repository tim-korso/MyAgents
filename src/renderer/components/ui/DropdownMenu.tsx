// DropdownMenu — the single "…" overflow-menu primitive. Wraps `Popover`
// with a MoreHorizontal trigger + a MenuItem row layout shared by every
// list/card/header that needs a secondary-actions dropdown.
//
// Prior state: two near-identical implementations — one inline in
// `TaskDetailOverlay` (32x32 trigger, 160px menu, delete-last pattern),
// one in `views/TaskItemActions` (24x24 trigger, 140px menu). Keeping
// two copies meant hover tints and separator styling drifted — the
// overlay's delete row got an extra top border, the card's didn't.
// This primitive captures the shared vocabulary so both read identically.
//
// Sections are rendered with a `<hr>` between them. Empty sections are
// silently dropped so callers can pass conditional groups without
// guarding each entry (e.g. "only show 归档 if status === done").

import { useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Popover } from './Popover';

export interface DropdownMenuItem {
  icon?: ReactNode;
  label: ReactNode;
  onClick: () => void;
  /** Red tint for destructive actions ("删除"). */
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  /** Tailwind classes layered on top of the default row style. Use for
   *  per-item tints (e.g. accent-warm for the primary "立即执行" action).
   *  When set, overrides the default + danger colour scheme. */
  className?: string;
}

export interface DropdownMenuSection {
  items: DropdownMenuItem[];
}

export interface DropdownMenuProps {
  /** Groups rendered with `<hr>` separators between them. Empty sections
   *  are skipped so callers can pass conditional groups without guarding
   *  each entry individually. */
  sections: DropdownMenuSection[];
  /** Trigger button size.
   *   - `sm` — 24×24 / 3.5 icon. For dense rows (card grid, list view).
   *   - `md` — 32×32 / 4 icon. For overlay / panel headers. */
  size?: 'sm' | 'md';
  /** Locks the trigger + all items during a busy async op. */
  disabled?: boolean;
  /**
   * Popover z-index override. Default inherits from `<Popover>` (260 — above
   * standard OverlayBackdrop tiers, below ConfirmDialog). Overlays that need
   * a precise layering relationship with their own backdrop can pass
   * `OVERLAY_Z + 1` or similar.
   */
  zIndex?: number;
  /** Menu minimum width in px. Default 140. */
  minWidth?: number;
  /** Trigger button tooltip. */
  title?: string;
}

export function DropdownMenu({
  sections,
  size = 'sm',
  disabled,
  zIndex,
  minWidth = 140,
  title,
}: DropdownMenuProps) {
  const { t } = useTranslation('app');
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const triggerTitle = title ?? t('dropdown.moreActions');

  // Drop empty sections so "0 visible groups" renders nothing, and a
  // single populated group doesn't leave a stray top separator.
  const nonEmpty = sections.filter((s) => s.items.length > 0);
  if (nonEmpty.length === 0) return null;

  const triggerCls =
    size === 'md'
      ? 'h-8 w-8 rounded-[var(--radius-md)]'
      : 'h-6 w-6 rounded-md';
  const iconCls = size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5';

  return (
    // `stopPropagation` on the wrapper — defensive against parents that
    // own a `<button>`-click handler (the task card's open-detail click,
    // for instance). Without it, opening the dropdown also triggers the
    // card's primary action.
    <div
      className="flex items-center"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title={triggerTitle}
        className={`flex items-center justify-center text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)] disabled:opacity-50 ${triggerCls}`}
      >
        <MoreHorizontal className={iconCls} />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={btnRef}
        placement="bottom-end"
        className="py-1"
        style={{ minWidth }}
        zIndex={zIndex}
      >
        {nonEmpty.map((section, idx) => (
          <div key={idx}>
            {idx > 0 && (
              <div className="my-1 border-t border-[var(--line-subtle)]" />
            )}
            {section.items.map((item, i) => (
              <MenuItem
                key={i}
                {...item}
                // Propagate the parent `disabled` (busy state) to every
                // item so an async op triggered AFTER the menu opened
                // (e.g. `busy` flips true while the popover is visible)
                // also locks the visible rows, not just the trigger
                // button. Without this a user could race-click a
                // secondary action during the in-flight op.
                disabled={disabled || item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
              />
            ))}
          </div>
        ))}
      </Popover>
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
  danger,
  title,
  className,
}: DropdownMenuItem) {
  const colour = className
    ? className
    : danger
      ? 'text-[var(--error)] hover:bg-[var(--error-bg)]'
      : 'text-[var(--ink-secondary)] hover:bg-[var(--hover-bg)] hover:text-[var(--ink)]';
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 ${colour}`}
    >
      {icon}
      {label}
    </button>
  );
}

export default DropdownMenu;
