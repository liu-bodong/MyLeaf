import type { EpochMillis, ProjectId } from '@myleaf/doc-model';
import type { ProjectPath } from './project-path.js';

/** Per-project behaviour switches. */
export interface ProjectSettings {
  /** Compile automatically after a pause in editing. */
  readonly autoCompile: boolean;
  /** Reuse a precompiled preamble between compiles when the engine supports it. */
  readonly precompilePreamble: boolean;
  /** Show live-rendered pages while editing, where the server offers it (ADR 0012). */
  readonly livePreview: boolean;
  /**
   * Most snapshots a live-preview session keeps for this project, below the
   * server's maximum; `null` for the server's maximum.
   */
  readonly liveSnapshots: number | null;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  autoCompile: false,
  precompilePreamble: true,
  livePreview: false,
  liveSnapshots: null,
};

export interface ProjectSummary {
  readonly id: ProjectId;
  readonly name: string;
  /** The file passed to the TeX engine. */
  readonly rootFile: ProjectPath;
  readonly createdAt: EpochMillis;
  readonly settings: ProjectSettings;
}

export interface ProjectFileEntry {
  readonly path: ProjectPath;
  /** Size in bytes. */
  readonly size: number;
}

export interface ProjectFile {
  readonly path: ProjectPath;
  readonly content: Uint8Array;
}

export const MAX_PROJECT_NAME_LENGTH = 200;

export class InvalidProjectNameError extends Error {
  constructor(name: string) {
    super(
      `Project name must be 1-${MAX_PROJECT_NAME_LENGTH} non-blank characters: ${JSON.stringify(name)}`,
    );
    this.name = 'InvalidProjectNameError';
  }
}

/** Trims and validates a project name. */
export function parseProjectName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PROJECT_NAME_LENGTH) {
    throw new InvalidProjectNameError(name);
  }
  return trimmed;
}
