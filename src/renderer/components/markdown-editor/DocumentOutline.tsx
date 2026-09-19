import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover } from '@/components/ui/Popover';
import { useCloseLayer } from '@/hooks/useCloseLayer';
import type { DocumentHeading } from './definitions';
import type { OutlineProjection } from './outlineProjection';

function OutlineCloseLayer({ close }: { close(): void }) {
  useCloseLayer(() => { close(); return true; }, 260);
  return null;
}

export default function DocumentOutline({ headings, active, complete, onNavigate }: OutlineProjection & { onNavigate(heading: DocumentHeading): void }) {
  const { t } = useTranslation('app');
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keyboard = useRef(false);
  const [open, setOpen] = useState(false);
  const cancel = useCallback(() => clearTimeout(timer.current), []);
  const close = useCallback(() => {
    cancel();
    if (panel.current?.contains(document.activeElement)) trigger.current?.focus({ preventScroll: true });
    setOpen(false); keyboard.current = false;
  }, [cancel]);
  useEffect(() => cancel, [cancel]);
  const enter = () => { cancel(); timer.current = setTimeout(() => setOpen(true), 65); };
  const leave = () => {
    cancel();
    if (!keyboard.current) timer.current = setTimeout(close, 180);
  };
  const attachPanel = useCallback((node: HTMLElement | null) => {
    panel.current = node;
    if (!node) return;
    const current = node.querySelector<HTMLButtonElement>('[aria-current="location"]');
    if (current) {
      const list = current.closest('ol');
      if (list) list.scrollTop = Math.max(0, current.offsetTop - list.offsetTop - list.clientHeight / 2);
      if (keyboard.current) current.focus({ preventScroll: true });
    }
  }, []);
  if (!headings.length) return null;
  const count = Math.min(24, headings.length);
  return <>
    <button ref={trigger} type="button" className="md-outline-trigger" aria-label={t('markdownEditor.outline.browse')} aria-expanded={open} aria-controls={open ? id : undefined}
      onPointerEnter={event => { if (event.pointerType !== 'touch') enter(); }} onPointerLeave={leave}
      onPointerDown={() => { keyboard.current = false; }}
      onFocus={event => { if (event.currentTarget.matches(':focus-visible')) { keyboard.current = true; setOpen(true); } }}
      onBlur={event => { if (!panel.current?.contains(event.relatedTarget as Node | null)) close(); }}
      onClick={() => { cancel(); setOpen(true); }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); keyboard.current = true; setOpen(true);
          panel.current?.querySelector<HTMLButtonElement>('[aria-current="location"]')?.focus();
        }
      }}>
      {Array.from({ length: count }, (_, i) => {
        const start = Math.floor(i * headings.length / count), end = Math.floor((i + 1) * headings.length / count);
        return <span key={i} aria-hidden="true" className="md-outline-tick" data-active={active >= start && active < end} style={{ '--outline-level': headings[start].level } as CSSProperties} />;
      })}
    </button>
    {open && <Popover open onClose={close} anchorRef={trigger} placement="right" offset={0} className="md-outline-popover">
      <OutlineCloseLayer close={close} />
      <nav ref={attachPanel} id={id} aria-label={t('markdownEditor.outline.title')} onPointerEnter={cancel} onPointerLeave={leave}
        onFocus={() => cancel()} onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null) && event.relatedTarget !== trigger.current) close();
        }} onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('ol button'));
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === 'ArrowDown' ? Math.min(index + 1, buttons.length - 1) : event.key === 'ArrowUp' ? Math.max(index - 1, 0) : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
          if (next >= 0) { event.preventDefault(); keyboard.current = true; buttons[next]?.focus(); }
        }}>
        <div className="md-outline-header"><span>{t('markdownEditor.outline.title')}</span><span>{complete ? t('markdownEditor.outline.count', { count: headings.length }) : t('markdownEditor.outline.indexing')}</span></div>
        <ol>{headings.map((heading, index) => <li key={heading.from} aria-level={heading.level}>
          <button type="button" aria-current={active === index ? 'location' : undefined} style={{ '--outline-level': heading.level } as CSSProperties}
            onPointerDown={() => { keyboard.current = false; }} onClick={() => { onNavigate(heading); close(); }}>
            <span>{heading.title || t('markdownEditor.outline.untitled')}</span>
          </button>
        </li>)}</ol>
      </nav>
    </Popover>}
  </>;
}
