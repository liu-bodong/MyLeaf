import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { SIDEBAR_DEFAULT } from './layout.js';

interface SidebarProps {
  readonly width: number;
  readonly min: number;
  readonly max: number;
  readonly onWidthChange: (width: number) => void;
  readonly children: ReactNode;
}

const KEY_STEP = 8;
const SHIFT_KEY_STEP = 40;

/**
 * File-tree sidebar with a draggable right edge. The new width is reported
 * when a drag ends or the handle is moved with the keyboard; double-click the
 * handle to reset. The resizer is hidden on narrow layouts, where the sidebar
 * stacks above the panes.
 */
export function Sidebar({ width, min, max, onWidthChange, children }: SidebarProps) {
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
    moveTo(clamp(start.current.width + (event.clientX - start.current.x)));
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
      ArrowLeft: width - step,
      ArrowRight: width + step,
      Home: min,
      End: max,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onWidthChange(clamp(Math.round(next)));
  };

  return (
    <>
      <aside className="sidebar" aria-label="Files" style={{ width: shown }}>
        {children}
      </aside>
      <div
        className="sidebar-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize file tree"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={shown}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => {
          if (width !== SIDEBAR_DEFAULT) onWidthChange(SIDEBAR_DEFAULT);
        }}
        onKeyDown={onKeyDown}
      />
    </>
  );
}
