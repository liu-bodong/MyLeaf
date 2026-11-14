import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { ProjectFile } from '@myleaf/project';

const BEGIN_DOCUMENT = '\\begin{document}';
// A `%` that is not escaped as `\%` starts a comment.
const COMMENT = /(?<!\\)%.*$/;

/**
 * The root file's text before the first `\begin{document}` that is not
 * commented out, or `null` if there is none.
 */
export function extractPreamble(source: string): string | null {
  let offset = 0;
  for (const line of source.split(/\r?\n/)) {
    // A `\begin{document}` inside \verb or a macro argument is treated as the
    // body start; full TeX tokenisation is out of scope for this check.
    const index = line.replace(COMMENT, '').indexOf(BEGIN_DOCUMENT);
    if (index >= 0) {
      return source.slice(0, offset + index);
    }
    offset += line.length;
    if (source.startsWith('\r\n', offset)) {
      offset += 2;
    } else if (source.startsWith('\n', offset)) {
      offset += 1;
    }
  }
  return null;
}

/** Validity record of a precompiled preamble, stored next to the format. */
interface FormatManifest {
  readonly status: 'ready' | 'failed';
  /** Hash of TeX version, root file path and preamble text. */
  readonly key: string;
  /** Project files read while building the format, with their content hashes. */
  readonly dependencies: Readonly<Record<string, string>>;
}

export type FormatState = 'ready' | 'failed' | 'missing';

export const FORMAT_NAME = 'preamble';
const MANIFEST = 'manifest.json';

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

export function formatKey(texVersion: string, rootFile: string, preamble: string): string {
  return sha256(`${texVersion}\0${rootFile}\0${preamble}`);
}

/**
 * Stores one precompiled preamble (a TeX format built with `mylatexformat`)
 * per project in `dir`, with a manifest saying which preamble and which
 * project files it was built from.
 */
export class PreambleFormatStore {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  get dir(): string {
    return this.#dir;
  }

  /** Whether the stored format matches `key` and the current project files. */
  async state(key: string, files: readonly ProjectFile[]): Promise<FormatState> {
    const manifest = await this.#readManifest();
    if (manifest?.key !== key) {
      return 'missing';
    }
    const current = new Map(files.map((file) => [file.path as string, file.content]));
    const unchanged = Object.entries(manifest.dependencies).every(([path, hash]) => {
      const content = current.get(path);
      return content !== undefined && sha256(content) === hash;
    });
    return unchanged ? manifest.status : 'missing';
  }

  /**
   * Records a format built in `buildDir` (which must contain
   * `preamble.fmt` and the recorder file `preamble.fls`). The root file is
   * not a dependency: its preamble is already part of `key`, and its body
   * must be free to change.
   */
  async commit(
    key: string,
    buildDir: string,
    srcDir: string,
    rootFile: string,
    files: readonly ProjectFile[],
  ): Promise<void> {
    const recorded = await readFile(join(buildDir, `${FORMAT_NAME}.fls`), 'utf8');
    const contents = new Map(files.map((file) => [file.path as string, file.content]));
    const dependencies: Record<string, string> = {};
    for (const input of readRecordedInputs(recorded, srcDir)) {
      const content = contents.get(input);
      if (content !== undefined && input !== rootFile) {
        dependencies[input] = sha256(content);
      }
    }
    await mkdir(this.#dir, { recursive: true });
    await rename(join(buildDir, `${FORMAT_NAME}.fmt`), join(this.#dir, `${FORMAT_NAME}.fmt`));
    await this.#writeManifest({ status: 'ready', key, dependencies });
  }

  /** Remembers that this preamble cannot be precompiled, so it is not retried. */
  async markFailed(key: string): Promise<void> {
    await rm(join(this.#dir, `${FORMAT_NAME}.fmt`), { force: true });
    await this.#writeManifest({ status: 'failed', key, dependencies: {} });
  }

  async #readManifest(): Promise<FormatManifest | null> {
    try {
      return JSON.parse(await readFile(join(this.#dir, MANIFEST), 'utf8')) as FormatManifest;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async #writeManifest(manifest: FormatManifest): Promise<void> {
    await mkdir(this.#dir, { recursive: true });
    const temp = join(this.#dir, `${MANIFEST}.tmp`);
    await writeFile(temp, JSON.stringify(manifest));
    await rename(temp, join(this.#dir, MANIFEST));
  }
}

/**
 * Project-relative paths of the files listed as `INPUT` in a TeX recorder
 * (`.fls`) file that lie inside `srcDir`. Relative entries are relative to
 * `srcDir` (the working directory of the run).
 */
export function readRecordedInputs(recorded: string, srcDir: string): Set<string> {
  const inputs = new Set<string>();
  for (const line of recorded.split('\n')) {
    if (!line.startsWith('INPUT ')) continue;
    const path = relative(srcDir, resolve(srcDir, line.slice('INPUT '.length).trim()));
    if (path !== '' && path !== '..' && !path.startsWith(`..${sep}`)) {
      inputs.add(path.split(sep).join('/'));
    }
  }
  return inputs;
}
