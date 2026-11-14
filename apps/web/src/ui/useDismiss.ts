import { useEffect } from 'react';
import type { RefObject } from 'react';

/**
 * While `open`, closes on a pointer press outside `ref` or on Escape.
 * `onEscape` runs instead of `onClose` for Escape, so a menu can return focus
 * to its trigger without stealing focus on an outside click.
 */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
  onEscape: () => void = onClose,
): void {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !ref.current?.contains(event.target)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onEscape();
    };
    window.document.addEventListener('pointerdown', onPointerDown);
    window.document.addEventListener('keydown', onKeyDown);
    return () => {
      window.document.removeEventListener('pointerdown', onPointerDown);
      window.document.removeEventListener('keydown', onKeyDown);
    };
  }, [ref, open, onClose, onEscape]);
}
