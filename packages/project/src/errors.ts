import type { ProjectId } from '@myleaf/doc-model';
import type { ProjectPath } from './project-path.js';

export class ProjectNotFoundError extends Error {
  constructor(id: ProjectId) {
    super(`Project ${id} not found`);
    this.name = 'ProjectNotFoundError';
  }
}

export class FileNotFoundError extends Error {
  constructor(path: ProjectPath) {
    super(`File ${path} not found`);
    this.name = 'FileNotFoundError';
  }
}

export class FileAlreadyExistsError extends Error {
  constructor(path: ProjectPath) {
    super(`File ${path} already exists`);
    this.name = 'FileAlreadyExistsError';
  }
}

/** A path is used as a file and as a directory at the same time (e.g. `a` and `a/b`). */
export class PathConflictError extends Error {
  constructor(path: ProjectPath) {
    super(`Path ${path} conflicts with an existing file or directory`);
    this.name = 'PathConflictError';
  }
}
