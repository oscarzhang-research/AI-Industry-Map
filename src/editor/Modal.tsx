import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Editor shell: scrim + modal with a sticky header and footer. Closing with unsaved changes asks for
 * confirmation inside the modal (browser dialogs are unavailable in some embeds).
 */
export function Modal({
  title,
  sub,
  dirty,
  onClose,
  children,
  footer,
  wide = true,
}: {
  title: ReactNode;
  sub?: ReactNode;
  dirty: boolean;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  wide?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const tryClose = () => (dirty ? setAsking(true) : onClose());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (dirty) setAsking(true);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [dirty, onClose]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('input, textarea, select, [contenteditable="true"]')?.focus();
  }, []);

  return (
    <>
      <div className="scrim" onClick={tryClose} />
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Editor'} ref={ref}>
        <div className="modal-head">
          <div className="min0">
            <h2 style={{ fontSize: 'var(--step-2)' }}>{title}</h2>
            {sub ? (
              <div className="muted" style={{ fontSize: 'var(--step--2)', marginTop: 2 }}>
                {sub}
              </div>
            ) : null}
          </div>
          <button type="button" className="btn icon ghost" aria-label="Close" onClick={tryClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">
          {asking ? (
            <div className="row" style={{ marginRight: 'auto' }}>
              <span className="down" style={{ fontSize: 'var(--step--1)', fontWeight: 600 }}>
                Discard unsaved changes?
              </span>
              <button type="button" className="btn sm" onClick={onClose}>
                Discard
              </button>
              <button type="button" className="btn sm primary" onClick={() => setAsking(false)}>
                Keep editing
              </button>
            </div>
          ) : null}
          {footer}
        </div>
      </div>
    </>
  );
}

/** Two-step delete button: the first click arms it. */
export function DeleteButton({ onDelete, label = 'Delete' }: { onDelete: () => void; label?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button type="button" className={`btn${armed ? ' danger' : ' ghost'}`} style={{ marginRight: 'auto' }} onClick={() => (armed ? onDelete() : setArmed(true))}>
      {armed ? 'Click again to delete' : label}
    </button>
  );
}
