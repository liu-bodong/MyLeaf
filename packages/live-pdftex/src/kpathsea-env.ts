import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * kpathsea variables the patched binary takes from the installed TeX Live.
 * It is not installed next to TeX Live's binaries, so values that TeX Live's
 * texmf.cnf derives from the binary's location ($SELFAUTOLOC,
 * $SELFAUTOPARENT, ... as on MacTeX and other TeX Live installs) would point
 * into the build directory. TEXMFCNF finds texmf.cnf; TEXMFROOT and
 * TEXMFLOCAL are the location-derived trees the other ones are based on.
 */
export const KPATHSEA_VARIABLES = ['TEXMFCNF', 'TEXMFROOT', 'TEXMFLOCAL'] as const;

/**
 * The installed TeX Live's values of KPATHSEA_VARIABLES, from `kpsewhich`
 * (empty ones left out), or `null` without `kpsewhich` or a TEXMFCNF.
 */
export async function kpathseaEnv(kpsewhich = 'kpsewhich'): Promise<Record<string, string> | null> {
  const env: Record<string, string> = {};
  for (const name of KPATHSEA_VARIABLES) {
    const value = await promisify(execFile)(kpsewhich, ['-var-value', name]).then(
      ({ stdout }) => stdout.trim(),
      () => '',
    );
    if (value !== '') env[name] = value;
  }
  return env.TEXMFCNF === undefined ? null : env;
}
