import type { Brand } from '@myleaf/doc-model';

/**
 * A validated path of a file inside a project: relative, `/`-separated, with
 * no empty, `.` or `..` segments. Holding a ProjectPath guarantees the path
 * cannot escape the project root.
 */
export type ProjectPath = Brand<string, 'ProjectPath'>;

export const MAX_PROJECT_PATH_LENGTH = 1024;

export class InvalidPathError extends Error {
  constructor(path: string, reason: string) {
    super(`Invalid project path ${JSON.stringify(path)}: ${reason}`);
    this.name = 'InvalidPathError';
  }
}

// Control characters, plus `\` and `:` which are separators or invalid on some platforms.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARACTERS = /[\u0000-\u001f\u007f\\:]/;

export function parseProjectPath(path: string): ProjectPath {
  if (path.length === 0 || path.length > MAX_PROJECT_PATH_LENGTH) {
    throw new InvalidPathError(path, `length must be 1-${MAX_PROJECT_PATH_LENGTH}`);
  }
  if (FORBIDDEN_CHARACTERS.test(path)) {
    throw new InvalidPathError(path, 'contains a forbidden character');
  }
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new InvalidPathError(path, 'must be relative, without empty, "." or ".." segments');
    }
  }
  return path as ProjectPath;
}

/** File name without directories, e.g. `fig.png` for `images/fig.png`. */
export function baseName(path: ProjectPath): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
