import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import Icon from './Icon';

interface DialogProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  description?: string;
  role?: 'dialog' | 'alertdialog';
}

const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export default function Dialog({ title, children, onClose, wide = false, description, role = 'dialog' }: DialogProps) {
  const element = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = element.current!;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = document.getElementById('root');
    const wasInert = background?.inert;
    const previousOverflow = document.body.style.overflow;
    if (background) background.inert = true;
    document.body.style.overflow = 'hidden';

    const focusable = () => [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(item => item.getClientRects().length > 0);
    const focusInitial = () => {
      const target = dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]')
        || dialog.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled), select:not(:disabled)')
        || focusable()[0] || dialog;
      target.focus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }
      if (event.key === 'Tab') {
        const items = focusable();
        const first = items[0];
        const last = items[items.length - 1];
        if (!first) { event.preventDefault(); dialog.focus(); }
        else if (!dialog.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
          event.preventDefault(); first.focus();
        }
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) focusInitial();
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocus);
    focusInitial();
    const observer = new MutationObserver(() => {
      if (!dialog.contains(document.activeElement)) focusInitial();
    });
    observer.observe(dialog, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocus);
      if (background) background.inert = wasInert || false;
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return createPortal(
    <div className="dialog-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={element} className={`modal ${wide ? 'wide' : ''}`} role={role} aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} tabIndex={-1}>
        <div className="modal-heading"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><Icon name="close" /></button></div>
        {description && <p id={descriptionId} className="modal-description">{description}</p>}
        {children}
      </section>
    </div>, document.body,
  );
}

export interface Confirmation {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
}

export function ConfirmDialog({ confirmation, onClose }: { confirmation: Confirmation; onClose: () => void }) {
  return <Dialog title={confirmation.title} description={confirmation.description} role="alertdialog" onClose={onClose}>
    <div className="modal-footer">
      <button className="button button-secondary" data-dialog-initial-focus onClick={onClose}>Cancel</button>
      <button className="button button-danger" onClick={() => { onClose(); confirmation.onConfirm(); }}>{confirmation.confirmLabel}</button>
    </div>
  </Dialog>;
}
