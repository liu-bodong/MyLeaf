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
}

/** Messages the browser sends on a project's live-preview WebSocket. */
export type LiveClientMessage =
  /** Full text of a project file that changed (not necessarily saved yet). */
  | { readonly type: 'update'; readonly path: string; readonly content: string }
  /** The 1-based, inclusive range of pages the browser shows (at most 20 pages). */
  | { readonly type: 'pages'; readonly first: number; readonly last: number };

/** Largest page range a browser may request in one `pages` message. */
export const LIVE_MAX_PAGE_RANGE = 20;

/**
 * A live page as a PDF of that one page. It travels as one binary WebSocket
 * message (`encodeLivePdfPage`).
 */
export interface LivePdfPageMessage {
  readonly type: 'page';
  readonly page: number;
  readonly pdf: Uint8Array;
  /** From a run older than the latest `stale` message covering the page. */
  readonly stale?: true;
}

/** Messages the server sends on a project's live-preview WebSocket. */
export type LiveServerMessage =
  /** `stale`: from a run older than the latest `stale` message covering the page. */
  | { readonly type: 'page'; readonly page: number; readonly svg: string; readonly stale?: true }
  | LivePdfPageMessage
  /** The page was rendered again with the same content: it is up to date. */
  | { readonly type: 'page-unchanged'; readonly page: number }
  /** Pages from `from` on are being typeset again and may be out of date. */
  | { readonly type: 'stale'; readonly from: number }
  /** Pages typeset so far; `final` once the whole document is. */
  | { readonly type: 'page-count'; readonly count: number; readonly final: boolean }
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

/** A PDF page message as binary: the message without `pdf` as a JSON line, then the PDF. */
export function encodeLivePdfPage(message: LivePdfPageMessage): Uint8Array {
  const { pdf, ...header } = message;
  // The header is ASCII (a type, a number, a flag), so one byte per character.
  const head = Uint8Array.from(`${JSON.stringify(header)}\n`, (char) => char.charCodeAt(0));
  const data = new Uint8Array(head.length + pdf.length);
  data.set(head);
  data.set(pdf, head.length);
  return data;
}

/** The message `encodeLivePdfPage` encoded. */
export function decodeLivePdfPage(data: Uint8Array): LivePdfPageMessage {
  const end = data.indexOf(0x0a);
  const header = JSON.parse(String.fromCharCode(...data.subarray(0, end))) as Omit<
    LivePdfPageMessage,
    'pdf'
  >;
  return { ...header, pdf: data.subarray(end + 1) };
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
