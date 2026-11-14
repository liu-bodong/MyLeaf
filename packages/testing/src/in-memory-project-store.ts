import { ProjectId } from '@myleaf/doc-model';
import {
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

interface StoredProject {
  summary: ProjectSummary;
  readonly files: Map<ProjectPath, Uint8Array>;
}

/** Reference implementation of the ProjectStore port, for tests. */
export class InMemoryProjectStore implements ProjectStore {
  readonly #projects = new Map<ProjectId, StoredProject>();
  #nextId = 1;

  listProjects(): Promise<readonly ProjectSummary[]> {
    return run(() => [...this.#projects.values()].map((p) => p.summary));
  }

  getProject(id: ProjectId): Promise<ProjectSummary | null> {
    return run(() => this.#projects.get(id)?.summary ?? null);
  }

  createProject(input: CreateProjectInput): Promise<ProjectSummary> {
    return run(() => {
      const summary: ProjectSummary = {
        id: ProjectId(`project-${this.#nextId++}`),
        name: parseProjectName(input.name),
        rootFile: input.rootFile,
        createdAt: Date.now(),
      };
      const files = new Map<ProjectPath, Uint8Array>();
      for (const file of input.files) {
        writeTo(files, file.path, file.content);
      }
      this.#projects.set(summary.id, { summary, files });
      return summary;
    });
  }

  updateProject(id: ProjectId, input: UpdateProjectInput): Promise<ProjectSummary> {
    return run(() => {
      const project = this.#get(id);
      project.summary = {
        ...project.summary,
        ...(input.name === undefined ? {} : { name: parseProjectName(input.name) }),
        ...(input.rootFile === undefined ? {} : { rootFile: input.rootFile }),
      };
      return project.summary;
    });
  }

  deleteProject(id: ProjectId): Promise<void> {
    return run(() => {
      this.#get(id);
      this.#projects.delete(id);
    });
  }

  listFiles(id: ProjectId): Promise<readonly ProjectFileEntry[]> {
    return run(() =>
      [...this.#get(id).files]
        .map(([path, content]) => ({ path, size: content.byteLength }))
        .sort((a, b) => (a.path < b.path ? -1 : 1)),
    );
  }

  readFile(id: ProjectId, path: ProjectPath): Promise<Uint8Array> {
    return run(() => {
      const content = this.#get(id).files.get(path);
      if (content === undefined) {
        throw new FileNotFoundError(path);
      }
      return content.slice();
    });
  }

  writeFile(id: ProjectId, path: ProjectPath, content: Uint8Array): Promise<void> {
    return run(() => writeTo(this.#get(id).files, path, content));
  }

  deleteFile(id: ProjectId, path: ProjectPath): Promise<void> {
    return run(() => {
      if (!this.#get(id).files.delete(path)) {
        throw new FileNotFoundError(path);
      }
    });
  }

  moveFile(id: ProjectId, from: ProjectPath, to: ProjectPath): Promise<void> {
    return run(() => {
      const { files } = this.#get(id);
      const content = files.get(from);
      if (content === undefined) {
        throw new FileNotFoundError(from);
      }
      if (files.has(to)) {
        throw new FileAlreadyExistsError(to);
      }
      files.delete(from);
      try {
        writeTo(files, to, content);
      } catch (error) {
        files.set(from, content);
        throw error;
      }
    });
  }

  #get(id: ProjectId): StoredProject {
    const project = this.#projects.get(id);
    if (project === undefined) {
      throw new ProjectNotFoundError(id);
    }
    return project;
  }
}

/** Runs `fn` asynchronously so that thrown errors become rejections. */
function run<T>(fn: () => T): Promise<T> {
  return Promise.resolve().then(fn);
}

function writeTo(files: Map<ProjectPath, Uint8Array>, path: ProjectPath, content: Uint8Array) {
  for (const existing of files.keys()) {
    if (existing.startsWith(`${path}/`) || path.startsWith(`${existing}/`)) {
      throw new PathConflictError(path);
    }
  }
  files.set(path, content.slice());
}
