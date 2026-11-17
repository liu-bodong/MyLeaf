/**
 * Timestamps of live-preview stages in the browser, for comparing engines
 * (`pnpm bench:live-engines`). Off unless the page was opened with
 * `liveTiming` in its query string or `localStorage['myleaf.liveTiming']`
 * is `1`; then marks collect in `window.__myleafLiveTiming`.
 *
 * Times are `performance.timeOrigin + performance.now()`: milliseconds
 * since the epoch, comparable with the server's (MYLEAF_LIVE_TIMING) on the
 * same machine.
 */
export interface LiveTimingMark {
  readonly t: number;
  readonly kind: string;
  readonly [field: string]: unknown;
}

declare global {
  interface Window {
    __myleafLiveTiming?: LiveTimingMark[];
  }
}

function enabled(): boolean {
  try {
    return (
      new URLSearchParams(window.location.search).has('liveTiming') ||
      window.localStorage.getItem('myleaf.liveTiming') === '1'
    );
  } catch {
    return false;
  }
}

const marks: LiveTimingMark[] | null =
  typeof window !== 'undefined' && enabled() ? (window.__myleafLiveTiming ??= []) : null;

/** Whether marks are recorded. */
export const liveTimingOn = marks !== null;

/** Records `kind` now, with `fields`; does nothing unless timing is on. */
export function liveMark(kind: string, fields: Record<string, unknown> = {}): void {
  marks?.push({ ...fields, t: performance.timeOrigin + performance.now(), kind });
}

/** Records `kind` once the browser has painted the current frame (after the next one starts). */
export function liveMarkAfterPaint(kind: string, fields: Record<string, unknown> = {}): void {
  if (marks === null) return;
  requestAnimationFrame(() => setTimeout(() => liveMark(kind, fields), 0));
}
