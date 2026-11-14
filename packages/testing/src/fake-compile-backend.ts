import type {
  CompileBackend,
  CompileRequest,
  CompileResult,
  PdfPoint,
  PdfRect,
  SourceLocation,
} from '@myleaf/compile';
import type { ProjectId } from '@myleaf/doc-model';
import type { ProjectFile } from '@myleaf/project';

/**
 * CompileBackend test double: records requests, "compiles" instantly and
 * answers searches with fixed values. Not a real TeX engine.
 */
export class FakeCompileBackend implements CompileBackend {
  readonly requests: CompileRequest[] = [];
  readonly discarded: ProjectId[] = [];
  pdf: Uint8Array | null = null;
  /** Returned by `readBibliography`. */
  bibliography: ProjectFile | null = null;
  readonly rect: PdfRect = { page: 1, x: 10, y: 20, width: 30, height: 5 };

  compile(request: CompileRequest): Promise<CompileResult> {
    this.requests.push(request);
    this.pdf = new TextEncoder().encode('%PDF-fake');
    return Promise.resolve({
      status: 'success',
      hasPdf: true,
      durationMs: 1,
      log: '',
      diagnostics: [],
      preamble: request.options.precompilePreamble ? 'reused' : 'disabled',
    });
  }
  readPdf(): Promise<Uint8Array | null> {
    return Promise.resolve(this.pdf);
  }
  readBibliography(): Promise<ProjectFile | null> {
    return Promise.resolve(this.bibliography);
  }
  forwardSearch(_id: ProjectId, location: SourceLocation): Promise<readonly PdfRect[]> {
    return Promise.resolve(location.line === 1 ? [this.rect] : []);
  }
  inverseSearch(_id: ProjectId, point: PdfPoint): Promise<SourceLocation | null> {
    return Promise.resolve({
      file: 'main.tex' as SourceLocation['file'],
      line: point.page,
      column: null,
    });
  }
  discard(projectId: ProjectId): Promise<void> {
    this.discarded.push(projectId);
    return Promise.resolve();
  }
}
