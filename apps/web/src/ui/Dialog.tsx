import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

interface DialogProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/**
 * Modal dialog on the native `<dialog>` element, which supplies the focus
 * trap, backdrop and Escape handling. Render it while open and unmount it to
 * close; focus returns to whatever was focused before it opened.
 */
export function Dialog({ title, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onCancel = (event: Event) => {
      // Keep the element mounted; React removes it once the parent closes.
      event.preventDefault();
      onCloseRef.current();
    };
    dialog.addEventListener('cancel', onCancel);
    dialog.showModal();
    return () => {
      dialog.removeEventListener('cancel', onCancel);
      dialog.close();
      previous?.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onClick={(event) => {
        // A press on the backdrop targets the dialog element itself.
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      <header className="dialog-header">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close"
          onClick={() => onCloseRef.current()}
        >
          ×
        </button>
      </header>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
