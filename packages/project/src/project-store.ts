import type { ProjectId } from '@myleaf/doc-model';
import type { ProjectFile, ProjectFileEntry, ProjectSettings, ProjectSummary } from './project.js';
import type { ProjectPath } from './project-path.js';

export interface CreateProjectInput {
  readonly name: string;
  readonly rootFile: ProjectPath;
  readonly files: readonly ProjectFile[];
  /** Missing settings take their defaults. */
  readonly settings?: Partial<ProjectSettings>;
}

export interface UpdateProjectInput {
  readonly name?: string;
  readonly rootFile?: ProjectPath;
  /** Merged into the current settings. */
  readonly settings?: Partial<ProjectSettings>;
}

/**
 * Port: persistent storage of projects and their files.
 *
 * Methods taking a project id throw ProjectNotFoundError for unknown ids.
 * Every implementation must pass the contract suite in `@myleaf/testing`.
 */
export interface ProjectStore {
  /** Projects, oldest first. */
  listProjects(): Promise<readonly ProjectSummary[]>;

  /** @returns `null` if the project does not exist. */
  getProject(id: ProjectId): Promise<ProjectSummary | null>;

  createProject(input: CreateProjectInput): Promise<ProjectSummary>;

  updateProject(id: ProjectId, input: UpdateProjectInput): Promise<ProjectSummary>;

  deleteProject(id: ProjectId): Promise<void>;

  /** Files sorted by path. Directories are implicit and not listed. */
  listFiles(id: ProjectId): Promise<readonly ProjectFileEntry[]>;

  /** @throws FileNotFoundError */
  readFile(id: ProjectId, path: ProjectPath): Promise<Uint8Array>;

  /**
   * Creates or replaces a file; missing parent directories are implied.
   * @throws PathConflictError if `path` or one of its parents is used the other way round.
   */
  writeFile(id: ProjectId, path: ProjectPath, content: Uint8Array): Promise<void>;

  /** @throws FileNotFoundError */
  deleteFile(id: ProjectId, path: ProjectPath): Promise<void>;

  /**
   * @throws FileNotFoundError if `from` does not exist.
   * @throws FileAlreadyExistsError if `to` exists.
   * @throws PathConflictError as in writeFile.
   */
  moveFile(id: ProjectId, from: ProjectPath, to: ProjectPath): Promise<void>;
}
