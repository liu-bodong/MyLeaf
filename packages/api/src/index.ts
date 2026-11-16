/**
 * HTTP API contract shared by the server and its clients. JSON bodies use the
 * domain types directly; they contain only JSON-compatible values.
 */
import type { AuxReferences } from '@myleaf/latex-syntax';
import type { CompileResult, PdfPoint, PdfRect, SourceLocation, TexEngine } from '@myleaf/compile';
import type { ProjectId } from '@myleaf/doc-model';
import type {
  ProjectFileEntry,
  ProjectPath,
  ProjectSettings,
  ProjectSummary,
} from '@myleaf/project';

export type ProjectDto = ProjectSummary;
export type FileEntryDto = ProjectFileEntry;

export interface CreateProjectRequest {
  readonly name: string;
}

/**
 * `POST /api/projects/import`: query string of a zip upload. The body is the
 * zip itself, sent as `application/zip`.
 */
export interface ImportProjectQuery {
  readonly name: string;
}

export interface UpdateProjectRequest {
  readonly name?: string;
  readonly rootFile?: string;
  /** Merged into the current settings. */
  readonly settings?: Partial<ProjectSettings>;
}

export interface MoveFileRequest {
  readonly from: string;
  readonly to: string;
}

export interface CompileRequestBody {
  readonly engine?: TexEngine;
  /** One engine pass for compiles while editing (`CompileOptions.singlePass`). */
  readonly singlePass?: boolean;
}

export type CompileResponse = CompileResult;

/** `GET /api/projects/:id/references`: numbers recorded by the latest compile; null before one. */
export type ReferencesResponse = AuxReferences | null;

export type ForwardSearchRequest = SourceLocation;

export interface ForwardSearchResponse {
  readonly rects: readonly PdfRect[];
}

export type InverseSearchRequest = PdfPoint;

export interface InverseSearchResponse {
  readonly location: SourceLocation | null;
}

/** `GET /api/live-preview`: whether this server offers live preview (ADR 0012). */
export interface LivePreviewInfo {
  readonly available: boolean;
  /** The engine that typesets live pages, or `null` when not available. */
  readonly engine: TexEngine | null;
  /**
   * Most snapshots a session may keep on this server
   * (`MYLEAF_LIVE_MAX_SNAPSHOTS`), or `null` when the engine has none.
   */
  readonly maxSnapshots: number | null;
  /** Whether live pages map to the source and back (SyncTeX `forward`/`inverse` messages). */
  readonly synctex: boolean;
}

/** Messages the browser sends on a project's live-preview WebSocket. */
export type LiveClientMessage =
  /** Full text of a project file that changed (not necessarily saved yet). */
  | { readonly type: 'update'; readonly path: string; readonly content: string }
  /** The 1-based, inclusive range of pages the browser shows (at most 20 pages). */
  | { readonly type: 'pages'; readonly first: number; readonly last: number }
  /**
   * SyncTeX on the live pages, as of the last finished run: the server
   * answers with a `forward-result` or `inverse-result` of the same `id`.
   */
  | {
      readonly type: 'forward';
      readonly id: number;
      readonly path: string;
      readonly line: number;
      readonly column: number | null;
    }
  | {
      readonly type: 'inverse';
      readonly id: number;
      readonly page: number;
      readonly x: number;
      readonly y: number;
    };

/** Largest page range a browser may request in one `pages` message. */
export const LIVE_MAX_PAGE_RANGE = 20;

/**
 * A live page as a PDF of that one page. It travels as one binary WebSocket
 * message (`encodeLiveBinary`).
 */
export interface LivePdfPageMessage {
  readonly type: 'page';
  readonly page: number;
  readonly pdf: Uint8Array;
  /**
   * Ids of the font programs left out of `pdf`, each sent before in a
   * `font` message on this connection (since the last `fonts-reset`). In
   * `pdf`, such a font stream has no data and `/MyLeafFont (id)`
   * (`LIVE_PDF_FONT_KEY`) in its dictionary; the font's data is its raw data.
   */
  readonly fonts?: readonly string[];
  /** From a run older than the latest `stale` message covering the page. */
  readonly stale?: true;
}

/**
 * A font program that pages on this connection leave out, sent once. It
 * travels as one binary WebSocket message (`encodeLiveBinary`).
 */
export interface LiveFontMessage {
  readonly type: 'font';
  readonly id: string;
  /** The font stream's raw (still encoded) data. */
  readonly data: Uint8Array;
}

/** Key in a font stream's dictionary naming the font left out of it (see `LivePdfPageMessage`). */
export const LIVE_PDF_FONT_KEY = 'MyLeafFont';

/** Messages sent as binary WebSocket messages. */
export type LiveBinaryMessage = LivePdfPageMessage | LiveFontMessage;

/** Messages the server sends on a project's live-preview WebSocket. */
export type LiveServerMessage =
  /** `stale`: from a run older than the latest `stale` message covering the page. */
  | { readonly type: 'page'; readonly page: number; readonly svg: string; readonly stale?: true }
  | LiveBinaryMessage
  /**
   * The browser may forget the fonts sent so far: pages that follow name
   * only fonts sent after this. Pages it already has keep theirs.
   */
  | { readonly type: 'fonts-reset' }
  /** The page was rendered again with the same content: it is up to date. */
  | { readonly type: 'page-unchanged'; readonly page: number }
  /** Pages from `from` on are being typeset again and may be out of date. */
  | { readonly type: 'stale'; readonly from: number }
  /** Pages typeset so far; `final` once the whole document is. */
  | { readonly type: 'page-count'; readonly count: number; readonly final: boolean }
  /** Answers `forward`: none when the engine has no SyncTeX. */
  | { readonly type: 'forward-result'; readonly id: number; readonly rects: readonly PdfRect[] }
  /** Answers `inverse`: `null` when the engine has no SyncTeX. */
  | {
      readonly type: 'inverse-result';
      readonly id: number;
      readonly location: SourceLocation | null;
    }
  | {
      readonly type: 'status';
      /**
       * `starting`: session opened, first page follows. `unavailable`: not
       * offered by this server. `busy`: too many sessions. `stopped`: ended
       * (idle, or the renderer exited); `message` says why.
       */
      readonly state: 'starting' | 'unavailable' | 'busy' | 'stopped';
      readonly message?: string;
    };

/**
 * A binary message: the message without its bytes (`pdf` or `data`) as a
 * JSON line, then the bytes.
 */
export function encodeLiveBinary(message: LiveBinaryMessage): Uint8Array {
  const { header, bytes } =
    message.type === 'page'
      ? (({ pdf, ...rest }) => ({ header: rest, bytes: pdf }))(message)
      : (({ data, ...rest }) => ({ header: rest, bytes: data }))(message);
  // The header is ASCII (a type, numbers, a flag, base64url ids), so one byte per character.
  const head = Uint8Array.from(`${JSON.stringify(header)}\n`, (char) => char.charCodeAt(0));
  const encoded = new Uint8Array(head.length + bytes.length);
  encoded.set(head);
  encoded.set(bytes, head.length);
  return encoded;
}

/** The message `encodeLiveBinary` encoded. */
export function decodeLiveBinary(encoded: Uint8Array): LiveBinaryMessage {
  const end = encoded.indexOf(0x0a);
  const header = JSON.parse(String.fromCharCode(...encoded.subarray(0, end))) as
    Omit<LivePdfPageMessage, 'pdf'> | Omit<LiveFontMessage, 'data'>;
  const bytes = encoded.subarray(end + 1);
  return header.type === 'page' ? { ...header, pdf: bytes } : { ...header, data: bytes };
}

/** Body of every non-2xx JSON response. */
export interface ErrorResponse {
  /** Machine-readable error kind, e.g. `ProjectNotFoundError`. */
  readonly error: string;
  readonly message: string;
}

export const TEX_ENGINES: readonly TexEngine[] = ['pdflatex', 'xelatex', 'lualatex'];

const encodePath = (path: ProjectPath) => path.split('/').map(encodeURIComponent).join('/');

/** URL paths of the API. File contents are sent and received as raw bytes. */
export const apiRoutes = {
  projects: () => '/api/projects',
  importProject: (name: string) => `/api/projects/import?name=${encodeURIComponent(name)}`,
  project: (id: ProjectId) => `/api/projects/${encodeURIComponent(id)}`,
  files: (id: ProjectId) => `/api/projects/${encodeURIComponent(id)}/files`,
  file: (id: ProjectId, path: ProjectPath) =>
    `/api/projects/${encodeURIComponent(id)}/files/${encodePath(path)}`,
  moveFile: (id: ProjectId) => `/api/projects/${encodeURIComponent(id)}/move`,
  compile: (id: ProjectId) => `/api/projects/${encodeURIComponent(id)}/compile`,
  pdf: (id: ProjectId) => `/api/projects/${encodeURIComponent(id)}/output.pdf`,
  forwardSearch: (id: ProjectId) => `/api/projects/${encodeURIComponent(id)}/synctex/forward`,
  inverseSearch: (id: ProjectId) => `/api/projects/${encodeURIComponent(id)}/synctex/inverse`,
  references: (id: ProjectId) => `/api/projects/${encodeURIComponent(id)}/references`,
  livePreviewInfo: () => '/api/live-preview',
  /** WebSocket. */
  livePreview: (id: ProjectId) => `/api/projects/${encodeURIComponent(id)}/live`,
} as const;
