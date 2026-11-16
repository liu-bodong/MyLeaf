import type { PdfPoint, PdfRect, SourceLocation } from '@myleaf/compile';
import type { ProjectId } from '@myleaf/doc-model';
import type { ProjectFile, ProjectPath } from '@myleaf/project';

export interface LivePreviewRequest {
  readonly projectId: ProjectId;
  readonly rootFile: ProjectPath;
  /** The complete source tree at the start of the session. */
  readonly files: readonly ProjectFile[];
  /**
   * Most snapshots (paused copies of the typesetter inside the document)
   * the session may keep; the backend's `maxSnapshots` applies too.
   * Default: the backend's.
   */
  readonly maxSnapshots?: number;
}

export type LivePreviewEvent =
  /**
   * A page of the requested range was (re)rendered with new content: `svg`
   * is a standalone, valid SVG document, or `pdf` a PDF of that one page.
   * `stale`: rendered from a run older than the latest `stale` event that
   * covers the page.
   */
  | { readonly type: 'page'; readonly page: number; readonly svg: string; readonly stale?: true }
  | {
      readonly type: 'page';
      readonly page: number;
      readonly pdf: Uint8Array;
      readonly stale?: true;
    }
  /** A page of the requested range was rendered again, with the content last emitted. */
  | { readonly type: 'page-unchanged'; readonly page: number }
  /**
   * A run typesets the pages from `from` on again: until a page is emitted
   * again (without `stale`) or reported unchanged, it may be out of date.
   * Backends that do not report it omit it.
   */
  | { readonly type: 'stale'; readonly from: number }
  /**
   * Pages typeset so far; `final` once the whole document is. While the
   * document is being re-typeset after an edit, `count` can drop and grow.
   */
  | { readonly type: 'page-count'; readonly count: number; readonly final: boolean }
  /** The session ended without `close()` being called. */
  | { readonly type: 'stopped'; readonly reason: string };

/** A running live preview of one project. */
export interface LivePreviewSession {
  /** Replaces a file's content; the preview re-renders from the first changed byte. */
  updateFile(file: ProjectFile): void;
  /**
   * Sets the 1-based, inclusive range of pages to render. Pages of the range
   * are emitted once typeset, and again whenever their content changes.
   */
  showPages(first: number, last: number): void;
  /**
   * Changes the most snapshots the session may keep (`null`: the
   * backend's), from the next run. Backends without snapshots omit it.
   */
  setMaxSnapshots?(max: number | null): void;
  /**
   * SyncTeX on the live pages: boxes on the pages that `location` produced,
   * as of the last finished run. Backends without SyncTeX omit it.
   */
  forwardSearch?(location: SourceLocation): Promise<readonly PdfRect[]>;
  /** SyncTeX: the source that produced `point` of a live page, as of the last finished run. */
  inverseSearch?(point: PdfPoint): Promise<SourceLocation | null>;
  /** Stops the session and releases its resources. */
  close(): Promise<void>;
}

/** TeX engines a live-preview backend can typeset with. */
export type LiveEngine = 'pdflatex' | 'xelatex';

/**
 * Port: incremental rendering of the pages being viewed while the source is
 * edited (ADR 0012, 0014). Unlike CompileBackend, output is approximate (it may use
 * a different engine) and is delivered page by page as events.
 */
export interface LivePreviewBackend {
  /** The engine that typesets the live pages, which the UI names. */
  readonly engine: LiveEngine;
  /**
   * Most snapshots a session may keep (each is a process), or undefined for
   * a backend without snapshots.
   */
  readonly maxSnapshots?: number;
  /** Whether sessions answer `forwardSearch` and `inverseSearch`. */
  readonly synctex?: boolean;
  open(
    request: LivePreviewRequest,
    onEvent: (event: LivePreviewEvent) => void,
  ): Promise<LivePreviewSession>;
}
