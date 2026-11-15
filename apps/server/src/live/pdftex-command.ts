import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';
import { kpathseaEnv } from '@myleaf/live-pdftex';

export type PdftexChoice =
  | {
      readonly kind: 'enabled';
      readonly command: string;
      /** kpathsea variables of the installed TeX Live (`kpathseaEnv`). */
      readonly kpathsea: Readonly<Record<string, string>>;
    }
  /** `warn`: configured but unusable. `info`: not built. */
  | { readonly kind: 'disabled'; readonly level: 'warn' | 'info'; readonly reason: string };

export interface PdftexHost {
  /** Whether `path` is an executable file. */
  readonly executable: (path: string) => Promise<boolean>;
  /** The installed TeX Live's kpathsea variables, or `null` without TeX Live. */
  readonly kpathsea: () => Promise<Readonly<Record<string, string>> | null>;
  /** Whether MuPDF's `mutool`, which renders the pages, can be run. */
  readonly mutool: () => Promise<boolean>;
}

const output = (command: string, args: string[]) =>
  promisify(execFile)(command, args).then(
    ({ stdout }) => stdout.trim(),
    () => null,
  );

const host: PdftexHost = {
  executable: (path) =>
    access(path, constants.X_OK).then(
      () => true,
      () => false,
    ),
  kpathsea: () => kpathseaEnv(),
  mutool: async () => (await output('mutool', ['-v'])) !== null,
};

/**
 * Picks the patched pdfTeX for live preview (MYLEAF_LIVE_ENGINE=pdftex,
 * level 2 in docs/spikes/pdflatex-live-preview.md): `MYLEAF_PDFTEX` if set,
 * otherwise the build of vendor/pdftex/build.sh at `bundledPath`.
 */
export async function choosePdftex(
  configured: string | undefined,
  bundledPath: string,
  { executable, kpathsea, mutool }: PdftexHost = host,
): Promise<PdftexChoice> {
  const command = configured !== undefined && configured !== '' ? configured : bundledPath;
  if (!(await executable(command))) {
    return command === bundledPath
      ? {
          kind: 'disabled',
          level: 'info',
          reason: 'pdfTeX is not built (run vendor/pdftex/build.sh, or set MYLEAF_PDFTEX)',
        }
      : {
          kind: 'disabled',
          level: 'warn',
          reason: `MYLEAF_PDFTEX (${command}) is not an executable file; build it with vendor/pdftex/build.sh`,
        };
  }
  const env = await kpathsea();
  if (env === null) {
    return { kind: 'disabled', level: 'warn', reason: 'kpsewhich (TeX Live) was not found' };
  }
  if (!(await mutool())) {
    return { kind: 'disabled', level: 'warn', reason: 'mutool (MuPDF) was not found' };
  }
  return { kind: 'enabled', command, kpathsea: env };
}
