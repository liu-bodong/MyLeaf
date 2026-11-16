import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectFile } from '@myleaf/project';
import { runProcess } from './run-process.js';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Whether pdfTeX embeds this PNG slowly: it decodes it and compresses it
 * again (at `\pdfcompresslevel` 9) when it has an alpha channel (colour
 * types 4 and 6, as matplotlib writes), a `tRNS` transparency chunk, or is
 * interlaced. Other PNGs (and JPEGs) are copied as they are, which is fast.
 */
export function isSlowPng(content: Uint8Array): boolean {
  if (content.length < 33 || PNG_SIGNATURE.some((byte, i) => content[i] !== byte)) return false;
  const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
  const chunkType = (offset: number) =>
    String.fromCharCode(...content.subarray(offset + 4, offset + 8));
  if (chunkType(8) !== 'IHDR') return false;
  const colorType = content[25];
  const interlace = content[28];
  if (colorType === 4 || colorType === 6 || interlace === 1) return true;
  // tRNS comes before the first IDAT.
  for (let offset = 8; offset + 8 <= content.length;) {
    const type = chunkType(offset);
    if (type === 'tRNS') return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    offset += 12 + view.getUint32(offset);
  }
  return false;
}

/**
 * pdfTeX source that turns `image.png` into a one-page PDF exactly the
 * image's size. Including that PDF gives the same picture at the same size,
 * but pdfTeX copies its (already compressed) streams instead of decoding
 * and compressing the image on every compile.
 */
const CONVERT_TEX = String.raw`\pdfcompresslevel=9
\pdfximage{image.png}
\setbox0\hbox{\pdfrefximage\pdflastximage}
\pdfpagewidth=\wd0 \pdfpageheight=\ht0 \hoffset=-1in \voffset=-1in
\shipout\box0
\end
`;

export interface ImageCacheOptions {
  /** Directory of the converted images, shared by all projects. */
  readonly dir: string;
  /** Plain pdfTeX (the `pdftex` command of TeX Live). */
  readonly pdftexCommand?: string;
  readonly timeoutMs?: number;
  /** Conversions running at once. Default: 2. */
  readonly concurrency?: number;
  /** Most bytes of converted images to keep; least recently used go first. Default: 500 MB. */
  readonly maxBytes?: number;
}

export interface AppliedImages {
  /** The files, with slow PNGs replaced by their converted copies where those exist. */
  readonly files: ProjectFile[];
  /** Images replaced. */
  readonly reused: number;
  /** Slow images without a converted copy yet; `convertPending` makes them. */
  readonly pending: readonly ProjectFile[];
}

/**
 * Converted copies of images that are slow to embed (`isSlowPng`), by
 * content: `<dir>/<sha256 of TeX version and image>.pdf`, or `.failed` when
 * pdfTeX could not convert it. A copy is used under the image's own name:
 * pdfTeX recognises an image's type by its first bytes, not its extension.
 */
export class ImageCache {
  readonly #dir: string;
  readonly #pdftex: string;
  /** First line of `pdftex --version`, part of each image's key. */
  #texVersion: Promise<string> | null = null;
  readonly #timeoutMs: number;
  readonly #concurrency: number;
  readonly #maxBytes: number;
  /** Conversions queued or running, by key. */
  readonly #converting = new Map<string, Promise<void>>();
  #running = 0;
  readonly #waiting: (() => void)[] = [];

  constructor(options: ImageCacheOptions) {
    this.#dir = options.dir;
    this.#pdftex = options.pdftexCommand ?? 'pdftex';
    this.#timeoutMs = options.timeoutMs ?? 60_000;
    this.#concurrency = options.concurrency ?? 2;
    this.#maxBytes = options.maxBytes ?? 500 * 1024 * 1024;
  }

  /** Replaces slow images of `files` by their converted copies, where they exist. */
  async apply(files: readonly ProjectFile[]): Promise<AppliedImages> {
    let reused = 0;
    const pending: ProjectFile[] = [];
    const result = await Promise.all(
      files.map(async (file) => {
        if (!isSlowPng(file.content)) return file;
        const key = await this.#key(file.content);
        const path = join(this.#dir, `${key}.pdf`);
        const converted = await readFile(path).catch(() => null);
        if (converted === null) {
          if (!(await exists(join(this.#dir, `${key}.failed`)))) pending.push(file);
          return file;
        }
        reused++;
        // Marks it as recently used, for pruning.
        const now = new Date();
        await utimes(path, now, now).catch(() => {});
        return { path: file.path, content: new Uint8Array(converted) };
      }),
    );
    return { files: result, reused, pending };
  }

  /** Converts the images (from `apply`'s `pending`) that are not converted or being converted. */
  convertPending(images: readonly ProjectFile[]): Promise<void> {
    return Promise.all(images.map((image) => this.#convert(image.content))).then(() => {});
  }

  /** Resolves once no conversion is queued or running. */
  async idle(): Promise<void> {
    while (this.#converting.size > 0) await Promise.all(this.#converting.values());
  }

  async #key(content: Uint8Array): Promise<string> {
    return createHash('sha256')
      .update(await this.#getTexVersion())
      .update('\0')
      .update(content)
      .digest('hex');
  }

  #getTexVersion(): Promise<string> {
    this.#texVersion ??= runProcess(this.#pdftex, ['--version'], {
      cwd: tmpdir(),
      env: process.env,
      timeoutMs: 10_000,
    }).then(
      (result) => result.stdout.split('\n')[0] ?? '',
      // Without pdfTeX nothing converts; `apply` finds no copies.
      () => '',
    );
    return this.#texVersion;
  }

  async #convert(content: Uint8Array): Promise<void> {
    const key = await this.#key(content);
    const running = this.#converting.get(key);
    if (running) return running;
    const conversion = this.#limit(() => this.#runConversion(key, content)).finally(() =>
      this.#converting.delete(key),
    );
    this.#converting.set(key, conversion);
    return conversion;
  }

  async #runConversion(key: string, content: Uint8Array): Promise<void> {
    const target = join(this.#dir, `${key}.pdf`);
    if (await exists(target)) return;
    const work = join(this.#dir, `tmp-${randomUUID()}`);
    await mkdir(work, { recursive: true });
    try {
      await writeFile(join(work, 'image.png'), content);
      await writeFile(join(work, 'convert.tex'), CONVERT_TEX);
      const run = await runProcess(
        this.#pdftex,
        ['-interaction=nonstopmode', '-halt-on-error', '-no-shell-escape', 'convert.tex'],
        {
          cwd: work,
          // As for compiles: TeX reads and writes only here and in the distribution.
          env: { ...process.env, openin_any: 'p', openout_any: 'p', TEXMFOUTPUT: work },
          timeoutMs: this.#timeoutMs,
        },
      );
      const pdf = await readFile(join(work, 'convert.pdf')).catch(() => null);
      if (run.exitCode === 0 && pdf !== null) {
        // Renamed into place, so a compile never reads a partly written copy.
        await rename(join(work, 'convert.pdf'), target);
        await this.#prune();
      } else {
        await writeFile(join(this.#dir, `${key}.failed`), run.stdout.slice(-2000));
      }
    } catch (error) {
      // E.g. `pdftex` missing: not retried on every compile.
      await writeFile(join(this.#dir, `${key}.failed`), String(error)).catch(() => {});
      console.error('Converting an image failed:', error);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  async #limit<T>(task: () => Promise<T>): Promise<T> {
    if (this.#running >= this.#concurrency) {
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    }
    this.#running++;
    try {
      return await task();
    } finally {
      this.#running--;
      this.#waiting.shift()?.();
    }
  }

  /** Deletes the least recently used copies beyond `maxBytes`. */
  async #prune(): Promise<void> {
    const names = (await readdir(this.#dir)).filter((name) => name.endsWith('.pdf'));
    const entries = await Promise.all(
      names.map(async (name) => {
        const info = await stat(join(this.#dir, name)).catch(() => null);
        return { name, size: info?.size ?? 0, used: info?.mtimeMs ?? 0 };
      }),
    );
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    for (const entry of entries.sort((a, b) => a.used - b.used)) {
      if (total <= this.#maxBytes) break;
      await rm(join(this.#dir, entry.name), { force: true });
      total -= entry.size;
    }
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}
