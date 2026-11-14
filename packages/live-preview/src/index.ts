import type { ProjectId } from '@myleaf/doc-model';
import type { ProjectFile, ProjectPath } from '@myleaf/project';

export interface LivePreviewRequest {
  readonly projectId: ProjectId;
  readonly rootFile: ProjectPath;
  /** The complete source tree at the start of the session. */
  readonly files: readonly ProjectFile[];
}

export type LivePreviewEvent =
  /** A page was (re)rendered. `svg` is a standalone, valid SVG document. */
  | { readonly type: 'page'; readonly page: number; readonly svg: string }
  /** The session ended without `close()` being called. */
  | { readonly type: 'stopped'; readonly reason: string };

/** A running live preview of one project. */
export interface LivePreviewSession {
  /** Replaces a file's content; the preview re-renders from the first changed byte. */
  updateFile(file: ProjectFile): void;
  /** Shows a 1-based page; it is rendered (and typeset, if needed) and then emitted. */
  showPage(page: number): void;
  /** Stops the session and releases its resources. */
  close(): Promise<void>;
}

/**
 * Port: incremental rendering of the page being viewed while the source is
 * edited (ADR 0012). Unlike CompileBackend, output is approximate (it may use
 * a different engine) and is delivered page by page as events.
 */
export interface LivePreviewBackend {
  open(
    request: LivePreviewRequest,
    onEvent: (event: LivePreviewEvent) => void,
  ): Promise<LivePreviewSession>;
}
