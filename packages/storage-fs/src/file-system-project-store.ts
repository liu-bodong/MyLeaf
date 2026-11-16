import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { ProjectId } from '@myleaf/doc-model';
import {
  DEFAULT_PROJECT_SETTINGS,
  FileAlreadyExistsError,
  FileNotFoundError,
  PathConflictError,
  ProjectNotFoundError,
  parseProjectName,
} from '@myleaf/project';
import type {
  CreateProjectInput,
  ProjectFileEntry,
  ProjectPath,
  ProjectStore,
  ProjectSummary,
  UpdateProjectInput,
} from '@myleaf/project';

const METADATA_FILE = 'project.json';
const FILES_DIR = 'files';
const TEMP_DIR = 'tmp';
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * ProjectStore on the local filesystem. Layout per project:
 *
 *   <root>/<project-id>/project.json   metadata
 *   <root>/<project-id>/files/...      the project's files, as plain files
 *   <root>/<project-id>/tmp/           staging area for atomic writes
 *
 * Writes are atomic (write to tmp, then rename), so readers such as the
 * compiler never see a partially written file.
 */
export class FileSystemProjectStore implements ProjectStore {
  readonly #root: string;

  private constructor(root: string) {
    this.#root = root;
  }

  static async open(root: string): Promise<FileSystemProjectStore> {
    const absolute = resolve(root);
    await mkdir(absolute, { recursive: true });
    return new FileSystemProjectStore(absolute);
  }

  async listProjects(): Promise<readonly ProjectSummary[]> {
    const entries = await readdir(this.#root, { withFileTypes: true });
    const summaries = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && ID_PATTERN.test(entry.name))
        .map((entry) => this.getProject(ProjectId(entry.name))),
    );
    return summaries.filter((summary) => summary !== null);
  }

  async getProject(id: ProjectId): Promise<ProjectSummary | null> {
    if (!ID_PATTERN.test(id)) {
      return null;
    }
    try {
      const json = await readFile(join(this.#root, id, METADATA_FILE), 'utf8');
      const stored: unknown = JSON.parse(json);
      if (!hasProjectSummaryShape(stored)) {
        throw new Error(`Corrupt project metadata: ${id}`);
      }
      const summary = stored as ProjectSummary;
      // Metadata written before a setting existed takes its default.
      return { ...summary, settings: { ...DEFAULT_PROJECT_SETTINGS, ...summary.settings } };
    } catch (error) {
      if (isErrnoException(error, 'ENOENT')) {
        return null;
      }
      throw error;
    }
  }

  async createProject(input: CreateProjectInput): Promise<ProjectSummary> {
    const summary: ProjectSummary = {
      id: ProjectId(randomUUID()),
      name: parseProjectName(input.name),
      rootFile: input.rootFile,
      createdAt: Date.now(),
      settings: { ...DEFAULT_PROJECT_SETTINGS, ...input.settings },
    };
    const dir = join(this.#root, summary.id);
    await mkdir(join(dir, FILES_DIR), { recursive: true });
    await mkdir(join(dir, TEMP_DIR), { recursive: true });
    try {
      for (const file of input.files) {
        await this.#writeFile(summary.id, file.path, file.content);
      }
      // Written last: a project without metadata is not listed.
      await this.#writeMetadata(summary);
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
    return summary;
  }

  async updateProject(id: ProjectId, input: UpdateProjectInput): Promise<ProjectSummary> {
    const current = await this.#require(id);
    const updated: ProjectSummary = {
      ...current,
      ...(input.name === undefined ? {} : { name: parseProjectName(input.name) }),
      ...(input.rootFile === undefined ? {} : { rootFile: input.rootFile }),
      settings: { ...current.settings, ...input.settings },
    };
    await this.#writeMetadata(updated);
    return updated;
  }

  async deleteProject(id: ProjectId): Promise<void> {
    await this.#require(id);
    await rm(join(this.#root, id), { recursive: true, force: true });
  }

  async listFiles(id: ProjectId): Promise<readonly ProjectFileEntry[]> {
    await this.#require(id);
    const filesRoot = this.#filesRoot(id);
    const entries = await readdir(filesRoot, { recursive: true, withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const absolute = join(entry.parentPath, entry.name);
          const { size } = await stat(absolute);
          return { path: relative(filesRoot, absolute).split(sep).join('/') as ProjectPath, size };
        }),
    );
    return files.sort((a, b) => (a.path < b.path ? -1 : 1));
  }

  async readFile(id: ProjectId, path: ProjectPath): Promise<Uint8Array> {
    await this.#require(id);
    try {
      return new Uint8Array(await readFile(await this.#containedReal(id, path)));
    } catch (error) {
      if (isErrnoException(error, 'ENOENT', 'ENOTDIR', 'EISDIR')) {
        throw new FileNotFoundError(path);
      }
      throw error;
    }
  }

  async writeFile(id: ProjectId, path: ProjectPath, content: Uint8Array): Promise<void> {
    await this.#require(id);
    await this.#writeFile(id, path, content);
  }

  async deleteFile(id: ProjectId, path: ProjectPath): Promise<void> {
    await this.#require(id);
    await this.#requireFile(id, path);
    await rm(this.#absolute(id, path));
    await this.#removeEmptyParents(id, path);
  }

  async moveFile(id: ProjectId, from: ProjectPath, to: ProjectPath): Promise<void> {
    await this.#require(id);
    await this.#requireFile(id, from);
    const kind = await this.#kindOf(id, to);
    if (kind === 'file') {
      throw new FileAlreadyExistsError(to);
    }
    await this.#prepareFilePath(id, to, kind);
    await rename(this.#absolute(id, from), this.#absolute(id, to));
    await this.#removeEmptyParents(id, from);
  }

  async #require(id: ProjectId): Promise<ProjectSummary> {
    const summary = await this.getProject(id);
    if (summary === null) {
      throw new ProjectNotFoundError(id);
    }
    return summary;
  }

  async #requireFile(id: ProjectId, path: ProjectPath): Promise<void> {
    if ((await this.#kindOf(id, path)) !== 'file') {
      throw new FileNotFoundError(path);
    }
  }

  async #writeFile(id: ProjectId, path: ProjectPath, content: Uint8Array): Promise<void> {
    await this.#prepareFilePath(id, path, await this.#kindOf(id, path));
    const temp = join(this.#root, id, TEMP_DIR, randomUUID());
    await writeFile(temp, content);
    await rename(temp, this.#absolute(id, path));
  }

  async #writeMetadata(summary: ProjectSummary): Promise<void> {
    const temp = join(this.#root, summary.id, TEMP_DIR, randomUUID());
    await writeFile(temp, `${JSON.stringify(summary, null, 2)}\n`);
    await rename(temp, join(this.#root, summary.id, METADATA_FILE));
  }

  /** Ensures `path` can hold a file: it is not a directory and no parent is a file. */
  async #prepareFilePath(
    id: ProjectId,
    path: ProjectPath,
    kind: 'file' | 'directory' | null,
  ): Promise<void> {
    if (kind === 'directory') {
      throw new PathConflictError(path);
    }
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i++) {
      const parent = segments.slice(0, i).join('/') as ProjectPath;
      if ((await this.#kindOf(id, parent)) === 'file') {
        throw new PathConflictError(path);
      }
    }
    await mkdir(resolve(this.#absolute(id, path), '..'), { recursive: true });
  }

  async #kindOf(id: ProjectId, path: ProjectPath): Promise<'file' | 'directory' | null> {
    try {
      const stats = await stat(this.#absolute(id, path));
      return stats.isDirectory() ? 'directory' : 'file';
    } catch (error) {
      if (isErrnoException(error, 'ENOENT', 'ENOTDIR')) {
        return null;
      }
      throw error;
    }
  }

  async #removeEmptyParents(id: ProjectId, path: ProjectPath): Promise<void> {
    const segments = path.split('/').slice(0, -1);
    while (segments.length > 0) {
      try {
        await rmdir(this.#absolute(id, segments.join('/') as ProjectPath));
      } catch (error) {
        if (isErrnoException(error, 'ENOTEMPTY', 'EEXIST', 'ENOENT')) {
          return;
        }
        throw error;
      }
      segments.pop();
    }
  }

  #filesRoot(id: ProjectId): string {
    return join(this.#root, id, FILES_DIR);
  }

  /** Absolute path of a project file. ProjectPath is already validated; this re-checks containment. */
  #absolute(id: ProjectId, path: ProjectPath): string {
    const filesRoot = this.#filesRoot(id);
    const absolute = resolve(filesRoot, ...path.split('/'));
    if (!absolute.startsWith(filesRoot + sep)) {
      throw new Error(`Path escapes project root: ${path}`);
    }
    return absolute;
  }

  /**
   * Symlink-resolved path of a project file, verified to stay inside the
   * project. `#absolute` checks containment lexically only, so a symlink
   * inside `files/` could point outside; reads resolve the real path and
   * re-check it against the real root.
   */
  async #containedReal(id: ProjectId, path: ProjectPath): Promise<string> {
    const realRoot = await realpath(this.#filesRoot(id));
    const real = await realpath(this.#absolute(id, path));
    if (real !== realRoot && !real.startsWith(realRoot + sep)) {
      throw new Error(`Path escapes project root: ${path}`);
    }
    return real;
  }
}

/** Checks that a parsed `project.json` has the fields we rely on. */
function hasProjectSummaryShape(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { id, name, rootFile, createdAt, settings } = value as Record<string, unknown>;
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    typeof rootFile !== 'string' ||
    typeof createdAt !== 'number'
  ) {
    return false;
  }
  if (settings === undefined) {
    return true;
  }
  if (typeof settings !== 'object' || settings === null) {
    return false;
  }
  const record = settings as Record<string, unknown>;
  const snapshots = record.liveSnapshots;
  return (
    ['autoCompile', 'precompilePreamble', 'livePreview', 'reuseImages', 'draftImages'].every(
      (key) => record[key] === undefined || typeof record[key] === 'boolean',
    ) &&
    (snapshots === undefined ||
      snapshots === null ||
      (Number.isInteger(snapshots) && (snapshots as number) >= 0))
  );
}

function isErrnoException(error: unknown, ...codes: string[]): boolean {
  return error instanceof Error && 'code' in error && codes.includes(String(error.code));
}
