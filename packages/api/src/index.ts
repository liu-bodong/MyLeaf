/**
 * HTTP API contract shared by the server and its clients. JSON bodies use the
 * domain types directly; they contain only JSON-compatible values.
 */
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
}

export type CompileResponse = CompileResult;

export type ForwardSearchRequest = SourceLocation;

export interface ForwardSearchResponse {
  readonly rects: readonly PdfRect[];
}

export type InverseSearchRequest = PdfPoint;

export interface InverseSearchResponse {
  readonly location: SourceLocation | null;
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
  project: (id: ProjectId) => `/api/projects/${encodeURIComponent(id)}`,
  files: (id: ProjectId) => `/api/projects/${encodeURIComponent(id)}/files`,
  file: (id: ProjectId, path: ProjectPath) =>
    `/api/projects/${encodeURIComponent(id)}/files/${encodePath(path)}`,
  moveFile: (id: ProjectId) => `/api/projects/${encodeURIComponent(id)}/move`,
  compile: (id: ProjectId) => `/api/projects/${encodeURIComponent(id)}/compile`,
  pdf: (id: ProjectId) => `/api/projects/${encodeURIComponent(id)}/output.pdf`,
  forwardSearch: (id: ProjectId) => `/api/projects/${encodeURIComponent(id)}/synctex/forward`,
  inverseSearch: (id: ProjectId) => `/api/projects/${encodeURIComponent(id)}/synctex/inverse`,
} as const;
