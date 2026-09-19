// ViewToggle — 2-icon segmented control for switching the task panel
// between card and list views. Lives in the panel header next to the
// search icon. The choice is persisted in localStorage so returning
// users see the view they last picked.

import { LayoutGrid, List } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type TaskView = 'card' | 'list';

interface Props {
  value: TaskView;
  onChange: (view: TaskView) => void;
}

export function ViewToggle({ value, onChange }: Props) {
  const { t } = useTranslation('task');
  return (
    <div className="flex items-center rounded-md bg-[var(--paper-inset)] p-0.5">
      <ToggleButton
        active={value === 'card'}
        onClick={() => onChange('card')}
        title={t('tasks.viewCard')}
      >
        <LayoutGrid className="h-3.5 w-3.5" strokeWidth={1.5} />
      </ToggleButton>
      <ToggleButton
        active={value === 'list'}
        onClick={() => onChange('list')}
        title={t('tasks.viewList')}
      >
        <List className="h-3.5 w-3.5" strokeWidth={1.5} />
      </ToggleButton>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`flex h-5 w-6 items-center justify-center rounded transition-colors ${
        active
          ? 'bg-[var(--paper-elevated)] text-[var(--ink)] shadow-sm'
          : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
      }`}
    >
      {children}
    </button>
  );
}
