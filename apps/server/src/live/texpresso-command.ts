import { constants } from 'node:fs';
import { access } from 'node:fs/promises';

export type TexpressoChoice =
  | { readonly kind: 'enabled'; readonly command: string }
  /** `warn`: configured but unusable. `info`: not configured or not built. */
  | { readonly kind: 'disabled'; readonly level: 'warn' | 'info'; readonly reason: string };

const isExecutable = (path: string) =>
  access(path, constants.X_OK).then(
    () => true,
    () => false,
  );

/**
 * Picks the TeXpresso binary for live preview (ADR 0012): `MYLEAF_TEXPRESSO`
 * if set (`off` disables live preview), otherwise the build of
 * vendor/texpresso/build.sh at `bundledPath` if it exists.
 */
export async function chooseTexpresso(
  configured: string | undefined,
  bundledPath: string,
  executable: (path: string) => Promise<boolean> = isExecutable,
): Promise<TexpressoChoice> {
  if (configured === 'off') {
    return { kind: 'disabled', level: 'info', reason: 'MYLEAF_TEXPRESSO is off' };
  }
  if (configured !== undefined && configured !== '') {
    return (await executable(configured))
      ? { kind: 'enabled', command: configured }
      : {
          kind: 'disabled',
          level: 'warn',
          reason: `MYLEAF_TEXPRESSO (${configured}) is not an executable file; build it with vendor/texpresso/build.sh`,
        };
  }
  return (await executable(bundledPath))
    ? { kind: 'enabled', command: bundledPath }
    : {
        kind: 'disabled',
        level: 'info',
        reason: `TeXpresso is not built (run vendor/texpresso/build.sh, or set MYLEAF_TEXPRESSO)`,
      };
}
