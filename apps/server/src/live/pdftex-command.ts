import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
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
}

const host: PdftexHost = {
  executable: (path) =>
    access(path, constants.X_OK).then(
      () => true,
      () => false,
    ),
  kpathsea: () => kpathseaEnv(),
};

/**
 * Picks the patched pdfTeX for live preview (MYLEAF_LIVE_ENGINE=pdftex,
 * level 2 in docs/spikes/pdflatex-live-preview.md): `MYLEAF_PDFTEX` if set,
 * otherwise the build of vendor/pdftex/build.sh at `bundledPath`.
 */
export async function choosePdftex(
  configured: string | undefined,
  bundledPath: string,
  { executable, kpathsea }: PdftexHost = host,
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
  return { kind: 'enabled', command, kpathsea: env };
}
