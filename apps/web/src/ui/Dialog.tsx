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
    // Cover a close that does not go through `cancel`, e.g. a dialog form.
    // The `close` event is queued, so one from an earlier `close()` can arrive
    // after the dialog was shown again (React runs effects twice in
    // development); only a dialog that is still closed counts.
    const onCloseEvent = () => {
      if (!dialog.open) onCloseRef.current();
    };
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('close', onCloseEvent);
    dialog.showModal();
    return () => {
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('close', onCloseEvent);
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
        // Close only on a press on the backdrop, i.e. outside the dialog's box;
        // a press on its border stays inside it.
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        const outside =
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom;
        if (outside) onCloseRef.current();
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
