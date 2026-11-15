import { apiRoutes } from '@myleaf/api';
import type {
  CompileRequestBody,
  CompileResponse,
  ErrorResponse,
  FileEntryDto,
  ForwardSearchResponse,
  InverseSearchResponse,
  LivePreviewInfo,
  ProjectDto,
  ReferencesResponse,
  UpdateProjectRequest,
} from '@myleaf/api';
import type { PdfPoint, SourceLocation } from '@myleaf/compile';
import type { ProjectId } from '@myleaf/doc-model';
import type { ProjectPath } from '@myleaf/project';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, body: Partial<ErrorResponse>) {
    super(body.message ?? `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.error ?? 'Unknown';
  }
}

/** Typed client for the server's HTTP API. */
export class ApiClient {
  listProjects(): Promise<ProjectDto[]> {
    return this.#json('GET', apiRoutes.projects());
  }

  createProject(name: string): Promise<ProjectDto> {
    return this.#json('POST', apiRoutes.projects(), { name });
  }

  /** Creates a project from the files in a zip archive. */
  async importProject(name: string, zip: Blob): Promise<ProjectDto> {
    const response = await this.#fetch('POST', apiRoutes.importProject(name), {
      body: zip,
      headers: { 'content-type': 'application/zip' },
    });
    return (await response.json()) as ProjectDto;
  }

  getProject(id: ProjectId): Promise<ProjectDto> {
    return this.#json('GET', apiRoutes.project(id));
  }

  updateProject(id: ProjectId, update: UpdateProjectRequest): Promise<ProjectDto> {
    return this.#json('PATCH', apiRoutes.project(id), update);
  }

  deleteProject(id: ProjectId): Promise<void> {
    return this.#json('DELETE', apiRoutes.project(id));
  }

  listFiles(id: ProjectId): Promise<FileEntryDto[]> {
    return this.#json('GET', apiRoutes.files(id));
  }

  async readFile(id: ProjectId, path: ProjectPath): Promise<Uint8Array> {
    const response = await this.#fetch('GET', apiRoutes.file(id, path));
    return new Uint8Array(await response.arrayBuffer());
  }

  async writeFile(id: ProjectId, path: ProjectPath, content: Uint8Array | string): Promise<void> {
    const body = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    await this.#fetch('PUT', apiRoutes.file(id, path), {
      body: new Blob([body as Uint8Array<ArrayBuffer>]),
      headers: { 'content-type': 'application/octet-stream' },
    });
  }

  async deleteFile(id: ProjectId, path: ProjectPath): Promise<void> {
    await this.#fetch('DELETE', apiRoutes.file(id, path));
  }

  moveFile(id: ProjectId, from: ProjectPath, to: ProjectPath): Promise<void> {
    return this.#json('POST', apiRoutes.moveFile(id), { from, to });
  }

  compile(id: ProjectId, options: CompileRequestBody = {}): Promise<CompileResponse> {
    return this.#json('POST', apiRoutes.compile(id), options);
  }

  /** URL of the latest PDF; `version` defeats caching between compiles. */
  pdfUrl(id: ProjectId, version: number): string {
    return `${apiRoutes.pdf(id)}?v=${version}`;
  }

  forwardSearch(id: ProjectId, location: SourceLocation): Promise<ForwardSearchResponse> {
    return this.#json('POST', apiRoutes.forwardSearch(id), location);
  }

  inverseSearch(id: ProjectId, point: PdfPoint): Promise<InverseSearchResponse> {
    return this.#json('POST', apiRoutes.inverseSearch(id), point);
  }

  references(id: ProjectId): Promise<ReferencesResponse> {
    return this.#json('GET', apiRoutes.references(id));
  }

  livePreviewInfo(): Promise<LivePreviewInfo> {
    return this.#json('GET', apiRoutes.livePreviewInfo());
  }

  /** WebSocket URL of a project's live preview, on the page's own host. */
  livePreviewUrl(id: ProjectId): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}${apiRoutes.livePreview(id)}`;
  }

  async #json<T>(method: string, url: string, body?: unknown): Promise<T> {
    const response = await this.#fetch(method, url, {
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    });
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  async #fetch(method: string, url: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, { ...init, method });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as Partial<ErrorResponse>;
      throw new ApiError(response.status, body);
    }
    return response;
  }
}

export const api = new ApiClient();
