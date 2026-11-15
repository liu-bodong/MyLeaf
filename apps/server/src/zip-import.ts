import { InvalidPathError, parseProjectPath } from '@myleaf/project';
import type { ProjectFile, ProjectPath } from '@myleaf/project';
import { unzipSync } from 'fflate';

/** Largest zip upload accepted. */
export const MAX_ZIP_BYTES = 100 * 1024 * 1024;
/** Largest total size of the extracted files. */
export const MAX_EXTRACTED_BYTES = 500 * 1024 * 1024;
/** Most entries (files and folders) a zip may hold. */
export const MAX_ZIP_ENTRIES = 10_000;

export class InvalidArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidArchiveError';
  }
}

export class ArchiveTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveTooLargeError';
  }
}

export interface ExtractedProject {
  readonly rootFile: ProjectPath;
  readonly files: readonly ProjectFile[];
}

/** Entries created by operating systems, not by the project's author. */
function isJunk(name: string): boolean {
  return name.startsWith('__MACOSX/') || name === '.DS_Store' || name.endsWith('/.DS_Store');
}

/**
 * Reads the files of a zip archive into project files and picks the main
 * document. Every entry name must be a valid project path, so no file can be
 * written outside the project. Sizes are checked before anything is
 * decompressed.
 * @throws InvalidArchiveError if the zip is unreadable, has an unsafe entry or no main document.
 * @throws ArchiveTooLargeError if it exceeds the entry or size limits.
 */
export function extractProject(zip: Uint8Array): ExtractedProject {
  const names: string[] = [];
  const seen = new Set<string>();
  let entries = 0;
  let total = 0;
  let extracted: Record<string, Uint8Array>;
  try {
    extracted = unzipSync(zip, {
      filter: (entry) => {
        entries += 1;
        if (entries > MAX_ZIP_ENTRIES) {
          throw new ArchiveTooLargeError(`Zip has more than ${MAX_ZIP_ENTRIES} entries`);
        }
        if (entry.name.endsWith('/') || isJunk(entry.name)) return false;
        if (seen.has(entry.name)) {
          throw new InvalidArchiveError(`Zip lists ${JSON.stringify(entry.name)} more than once`);
        }
        seen.add(entry.name);
        // Stored entries are copied at their stored size, deflated ones
        // inflate into a buffer of their declared size and never beyond it.
        total += entry.compression === 0 ? entry.size : entry.originalSize;
        if (total > MAX_EXTRACTED_BYTES) {
          throw new ArchiveTooLargeError(
            `Zip contents exceed ${MAX_EXTRACTED_BYTES / (1024 * 1024)} MB`,
          );
        }
        names.push(entry.name);
        return true;
      },
    });
  } catch (error) {
    if (error instanceof InvalidArchiveError || error instanceof ArchiveTooLargeError) throw error;
    throw new InvalidArchiveError(
      `Not a readable zip file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const prefix = commonFolder(names);
  const files: ProjectFile[] = [];
  for (const name of names) {
    // Names such as `__proto__` are not stored as own properties.
    if (!Object.hasOwn(extracted, name)) {
      throw new InvalidArchiveError(`Unsupported entry name ${JSON.stringify(name)}`);
    }
    let path: ProjectPath;
    try {
      path = parseProjectPath(name.slice(prefix.length));
    } catch (error) {
      if (error instanceof InvalidPathError) {
        throw new InvalidArchiveError(`Unsafe entry ${JSON.stringify(name)}: ${error.message}`);
      }
      throw error;
    }
    files.push({ path, content: extracted[name]! });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { rootFile: findRootFile(files), files };
}

/**
 * `folder/` when every name is inside that one top-level folder, else `''`.
 * Archives made by zipping a folder (or downloaded from GitHub) wrap the project this way.
 */
function commonFolder(names: readonly string[]): string {
  if (names.length === 0) return '';
  const first = names[0]!;
  const slash = first.indexOf('/');
  if (slash <= 0) return '';
  const prefix = first.slice(0, slash + 1);
  return names.every((name) => name.startsWith(prefix)) ? prefix : '';
}

const DOCUMENT_CLASS = /^[ \t]*\\documentclass\b/m;
const PREFERRED_ROOT = 'main.tex';

/**
 * The `.tex` file with an uncommented `\documentclass` line. Among several:
 * `main.tex` at the top, else the shallowest, then alphabetically first.
 */
export function findRootFile(files: readonly ProjectFile[]): ProjectPath {
  const decoder = new TextDecoder();
  const candidates = files
    .filter((file) => file.path.endsWith('.tex'))
    .filter((file) => DOCUMENT_CLASS.test(decoder.decode(file.content)))
    .map((file) => file.path);
  if (candidates.length === 0) {
    throw new InvalidArchiveError('Zip has no .tex file with \\documentclass');
  }
  const preferred = candidates.find((path) => path === PREFERRED_ROOT);
  if (preferred !== undefined) return preferred;
  const depth = (path: string) => path.split('/').length;
  return [...candidates].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))[0]!;
}
