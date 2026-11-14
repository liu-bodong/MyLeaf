import type { EpochMillis, ProjectId } from '@myleaf/doc-model';
import type { ProjectPath } from './project-path.js';

export interface ProjectSummary {
  readonly id: ProjectId;
  readonly name: string;
  /** The file passed to the TeX engine. */
  readonly rootFile: ProjectPath;
  readonly createdAt: EpochMillis;
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
