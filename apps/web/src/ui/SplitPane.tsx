import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';

/** Which panes are shown. */
export type SplitView = 'both' | 'start' | 'end';

interface SplitPaneProps {
  readonly view: SplitView;
  /** Share of the width given to the start pane, between `min` and `max`. */
  readonly ratio: number;
  readonly min: number;
  readonly max: number;
  /** Called when a drag ends or the handle is moved with the keyboard. */
  readonly onRatioChange: (ratio: number) => void;
  /** Accessible name of the resize handle. */
  readonly label: string;
  readonly start: ReactNode;
  readonly end: ReactNode;
  /** Controls placed in the divider, e.g. buttons. They do not start a drag. */
  readonly divider?: ReactNode;
}

const KEY_STEP = 0.02;
const SHIFT_KEY_STEP = 0.1;
/** Ratio a double-click on the divider resets to. */
const RESET_RATIO = 0.5;

/**
 * Two panes side by side with a draggable divider. While dragging, only this
 * component re-renders; the new ratio is reported when the drag ends.
 */
export function SplitPane(props: SplitPaneProps) {
  const { view, ratio, min, max, onRatioChange, label, start, end, divider } = props;
  const container = useRef<HTMLDivElement>(null);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const shown = dragRatio ?? ratio;
  const clamp = (value: number) => Math.min(max, Math.max(min, value));

  const ratioAt = (clientX: number) => {
    const box = container.current?.getBoundingClientRect();
    return box === undefined || box.width === 0 ? ratio : clamp((clientX - box.left) / box.width);
  };

  /** Ratio of the drag in progress; a ref so events between renders see it. */
  const drag = useRef<number | null>(null);
  const moveTo = (value: number | null) => {
    drag.current = value;
    setDragRatio(value);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('button') !== null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    moveTo(ratioAt(event.clientX));
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current !== null) moveTo(ratioAt(event.clientX));
  };
  const endDrag = () => {
    const final = drag.current;
    if (final === null) return;
    moveTo(null);
    onRatioChange(final);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? SHIFT_KEY_STEP : KEY_STEP;
    const next = {
      ArrowLeft: ratio - step,
      ArrowRight: ratio + step,
      Home: min,
      End: max,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onRatioChange(clamp(next));
  };

  return (
    <div
      className={`split${dragRatio === null ? '' : ' dragging'}`}
      data-view={view}
      ref={container}
    >
      <div className="split-start" hidden={view === 'end'} style={{ flexBasis: `${shown * 100}%` }}>
        {start}
      </div>
      <div
        className="split-divider"
        hidden={view !== 'both'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(event) => {
          if ((event.target as Element).closest('button') !== null) return;
          onRatioChange(clamp(RESET_RATIO));
        }}
      >
        <div
          className="split-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label={label}
          aria-valuemin={Math.round(min * 100)}
          aria-valuemax={Math.round(max * 100)}
          aria-valuenow={Math.round(shown * 100)}
          tabIndex={0}
          onKeyDown={onKeyDown}
        />
        {divider}
      </div>
      <div className="split-end" hidden={view === 'start'}>
        {end}
      </div>
    </div>
  );
}
