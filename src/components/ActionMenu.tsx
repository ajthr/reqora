import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import type { IconName } from './Icon';

export interface MenuAction {
  label: string;
  icon: IconName;
  onSelect: () => void;
  danger?: boolean;
  separator?: boolean;
  disabled?: boolean;
}

export default function ActionMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);
  const id = useId();

  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const panel = menu.current.getBoundingClientRect();
    const top = rect.bottom + panel.height + 8 > window.innerHeight ? Math.max(8, rect.top - panel.height - 6) : rect.bottom + 6;
    setPosition({ top, left: Math.max(8, Math.min(rect.right - panel.width, window.innerWidth - panel.width - 8)) });
    const items = menu.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    (focusLast.current ? items[items.length - 1] : items[0])?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false);
    };
    const focusOutside = (event: FocusEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false);
    };
    const resize = () => setOpen(false);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', focusOutside);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', focusOutside);
      window.removeEventListener('resize', resize);
    };
  }, [open]);

  return <>
    <button ref={trigger} className={`icon-button item-menu-trigger ${open ? 'menu-open' : ''}`} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { focusLast.current = false; setOpen(current => !current); }}
      onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); focusLast.current = event.key === 'ArrowUp'; setOpen(true); } }}>
      <Icon name="more" size={17} />
    </button>
    {open && createPortal(<div ref={menu} id={id} role="menu" aria-label={label} className="action-menu-popover" style={position}
      onKeyDown={event => {
        const items = [...menu.current!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        } else if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
        }
      }}>
      {actions.map(action => <div key={action.label}>
        {action.separator && <div className="action-menu-separator" role="separator" />}
        <button role="menuitem" className={`action-menu-item ${action.danger ? 'danger' : ''}`} disabled={action.disabled} onClick={() => { trigger.current?.focus(); setOpen(false); action.onSelect(); }}>
          <Icon name={action.icon} size={15} /><span>{action.label}</span>
        </button>
      </div>)}
    </div>, document.body)}
  </>;
}
