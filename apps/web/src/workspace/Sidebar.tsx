import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { SIDEBAR_DEFAULT } from './layout.js';

interface SidebarProps {
  /** False hides the sidebar and its resizer; the content stays mounted. */
  readonly open: boolean;
  readonly width: number;
  readonly min: number;
  readonly max: number;
  readonly onWidthChange: (width: number) => void;
  readonly children: ReactNode;
  /** Edge of the workspace the sidebar is on; the resizer is on its inner edge. */
  readonly side?: 'start' | 'end';
  /** Accessible name of the sidebar. */
  readonly label?: string;
  /** Accessible name of the resizer. */
  readonly resizeLabel?: string;
  /** Width a double-click on the resizer resets to. */
  readonly defaultWidth?: number;
}

const KEY_STEP = 8;
const SHIFT_KEY_STEP = 40;

/**
 * Sidebar with a draggable inner edge (the file tree on the left, the outline
 * on the right). The new width is reported
 * when a drag ends or the handle is moved with the keyboard; double-click the
 * handle to reset. The resizer is hidden on narrow layouts, where the sidebar
 * stacks above the panes.
 */
export function Sidebar(props: SidebarProps) {
  const { open, width, min, max, onWidthChange, children } = props;
  const {
    side = 'start',
    label = 'Files',
    resizeLabel = 'Resize file tree',
    defaultWidth = SIDEBAR_DEFAULT,
  } = props;
  /** +1 if moving the pointer right widens the sidebar, −1 if it narrows it. */
  const direction = side === 'start' ? 1 : -1;
  const [dragged, setDragged] = useState<number | null>(null);
  const shown = Math.round(dragged ?? width);
  const clamp = (value: number) => Math.min(max, Math.max(min, value));

  /** Width of the drag in progress; a ref so events between renders see it. */
  const drag = useRef<number | null>(null);
  const start = useRef<{ x: number; width: number } | null>(null);
  const moveTo = (value: number | null) => {
    drag.current = value;
    setDragged(value);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, width };
    moveTo(width);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (start.current === null) return;
    moveTo(clamp(start.current.width + direction * (event.clientX - start.current.x)));
  };
  const endDrag = () => {
    const final = drag.current;
    start.current = null;
    if (final === null) return;
    moveTo(null);
    // A press without movement changes nothing; do not save the layout again.
    if (Math.round(final) !== width) onWidthChange(Math.round(final));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? SHIFT_KEY_STEP : KEY_STEP;
    const next = {
      ArrowLeft: width - direction * step,
      ArrowRight: width + direction * step,
      Home: min,
      End: max,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onWidthChange(clamp(Math.round(next)));
  };

  const aside = (
    <aside className={`sidebar ${side}`} aria-label={label} hidden={!open} style={{ width: shown }}>
      {children}
    </aside>
  );
  const resizer = (
    <div
      className={`sidebar-resizer ${side}`}
      hidden={!open}
      role="separator"
      aria-orientation="vertical"
      aria-label={resizeLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={shown}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => {
        if (width !== defaultWidth) onWidthChange(defaultWidth);
      }}
      onKeyDown={onKeyDown}
    />
  );
  return side === 'start' ? (
    <>
      {aside}
      {resizer}
    </>
  ) : (
    <>
      {resizer}
      {aside}
    </>
  );
}
