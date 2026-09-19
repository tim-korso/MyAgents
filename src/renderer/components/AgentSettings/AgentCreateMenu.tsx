// Agent create menu — dropdown for creating a new Agent from Settings page
// Two options: upgrade existing workspace, create from template
import { useState, useCallback, useRef, memo } from 'react';
import { Plus, FolderUp, LayoutTemplate } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Popover } from '@/components/ui/Popover';

interface AgentCreateMenuProps {
  onUpgradeWorkspace: () => void;
  onCreateFromTemplate: () => void;
}

export default memo(function AgentCreateMenu({
  onUpgradeWorkspace,
  onCreateFromTemplate,
}: AgentCreateMenuProps) {
  const { t } = useTranslation('settings');
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const toggle = useCallback(() => setOpen(prev => !prev), []);

  return (
    <>
      <button
        ref={buttonRef}
        onClick={toggle}
        className="flex items-center gap-1.5 rounded-lg bg-[var(--button-primary-bg)] px-3 py-2 text-sm font-medium text-[var(--button-primary-text)] transition-colors hover:bg-[var(--button-primary-bg-hover)]"
      >
        <Plus className="h-3.5 w-3.5" />
        {t('agentSettings.createMenu.create')}
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={buttonRef}
        placement="bottom-end"
        className="w-[200px] py-1"
      >
        <button
          type="button"
          role="menuitem"
          onClick={() => { setOpen(false); onUpgradeWorkspace(); }}
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[var(--ink)] transition-colors hover:bg-[var(--paper-inset)]"
        >
          <FolderUp className="h-3.5 w-3.5 text-[var(--ink-subtle)]" />
          {t('agentSettings.createMenu.upgradeWorkspace')}
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => { setOpen(false); onCreateFromTemplate(); }}
          className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[var(--ink)] transition-colors hover:bg-[var(--paper-inset)]"
        >
          <LayoutTemplate className="h-3.5 w-3.5 text-[var(--ink-subtle)]" />
          {t('agentSettings.createMenu.fromTemplate')}
        </button>
      </Popover>
    </>
  );
});
