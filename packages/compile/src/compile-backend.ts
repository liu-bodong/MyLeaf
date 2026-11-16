import type { ProjectId } from '@myleaf/doc-model';
import type { AuxReferences } from '@myleaf/latex-syntax';
import type { ProjectFile, ProjectPath } from '@myleaf/project';
import type { Diagnostic } from './diagnostics.js';

export type TexEngine = 'pdflatex' | 'xelatex' | 'lualatex';

export interface CompileOptions {
  /**
   * Reuse a precompiled preamble (the part of the root file before
   * `\begin{document}`) between compiles, where the backend supports it.
   */
  readonly precompilePreamble: boolean;
  /**
   * Run the engine once, reusing the auxiliary files of the previous compile
   * (references, citations and the table of contents as of that compile),
   * instead of running until they are stable. For compiles while editing.
   * Backends may compile fully instead, e.g. when there is no previous
   * compile. Default: false.
   */
  readonly singlePass?: boolean;
  /**
   * Reuse converted copies of images that are slow to embed, made after an
   * earlier compile, where the backend supports it. Default: false.
   */
  readonly reuseImages?: boolean;
  /**
   * Draw included graphics as boxes of their size with their file name
   * (graphicx's `draft` option), which skips reading and embedding them.
   * Default: false.
   */
  readonly draftImages?: boolean;
}

/**
 * What happened with the precompiled preamble during a compile.
 * - `reused`: the compile started from a precompiled preamble.
 * - `building`: compiled without one; one is being prepared for later compiles.
 * - `unavailable`: cannot be precompiled (unsupported engine, no
 *   `\begin{document}`, or precompiling this preamble failed).
 * - `disabled`: turned off by the request.
 */
export type PreambleStatus = 'reused' | 'building' | 'unavailable' | 'disabled';

export interface CompileRequest {
  readonly projectId: ProjectId;
  readonly rootFile: ProjectPath;
  readonly engine: TexEngine;
  /**
   * The complete source tree to compile. Passed explicitly (rather than read
   * from storage) so callers can compile a projection, e.g. with suggestions
   * applied (ADR 0005).
   */
  readonly files: readonly ProjectFile[];
  readonly options: CompileOptions;
}

/** `failure`: the engine reported errors (a PDF may still exist). `timeout`: the run was killed. */
export type CompileStatus = 'success' | 'failure' | 'timeout';

export interface CompileResult {
  readonly status: CompileStatus;
  readonly hasPdf: boolean;
  readonly durationMs: number;
  /** The engine's log file for the root document (empty if none was written). */
  readonly log: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly preamble: PreambleStatus;
}

/** A position in a source file. `line` is 1-based; `column` is 1-based or null if unknown. */
export interface SourceLocation {
  readonly file: ProjectPath;
  readonly line: number;
  readonly column: number | null;
}

/** A point on a PDF page, in PDF points (1/72 in) from the page's top-left corner. */
export interface PdfPoint {
  readonly page: number;
  readonly x: number;
  readonly y: number;
}

/** A box on a PDF page; `x`/`y` is its top-left corner. Units as in PdfPoint. */
export interface PdfRect extends PdfPoint {
  readonly width: number;
  readonly height: number;
}

/**
 * Port: turns a project's source into a PDF and maps between source and PDF
 * positions (SyncTeX). Implementations keep per-project build state so
 * repeated compiles can be incremental. Compiles of one project are
 * serialized; compiles of different projects may run concurrently.
 */
export interface CompileBackend {
  compile(request: CompileRequest): Promise<CompileResult>;

  /** The PDF of the latest compile, or `null` if none exists. */
  readPdf(projectId: ProjectId): Promise<Uint8Array | null>;

  /**
   * The bibliography (`<job>.bbl`, BibTeX or Biber output) of the latest
   * compile, with the project path where TeX looks for it, or `null` if none.
   * Lets engines that do not run BibTeX, such as live preview, show citations.
   */
  readBibliography(projectId: ProjectId): Promise<ProjectFile | null>;

  /**
   * Label and citation numbers the latest compile recorded (its `.aux` files),
   * for showing them outside the PDF (visual mode); null before the first compile.
   */
  readReferences(projectId: ProjectId): Promise<AuxReferences | null>;

  /** PDF boxes produced by a source location (empty if none). */
  forwardSearch(projectId: ProjectId, location: SourceLocation): Promise<readonly PdfRect[]>;

  /** Source location that produced a PDF point, or `null` if none. */
  inverseSearch(projectId: ProjectId, point: PdfPoint): Promise<SourceLocation | null>;

  /** Removes all build state of a project. */
  discard(projectId: ProjectId): Promise<void>;
}
