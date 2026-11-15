import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kpathseaEnv } from './kpathsea-env.js';

describe.skipIf(process.platform === 'win32')('kpathseaEnv', () => {
  let dir: string;
  /** A stand-in for kpsewhich that answers `-var-value <name>` from `values`. */
  const fakeKpsewhich = async (name: string, values: Record<string, string>) => {
    const cases = Object.entries(values)
      .map(([variable, value]) => `  ${variable}) echo '${value}' ;;`)
      .join('\n');
    const path = join(dir, name);
    await writeFile(path, `#!/bin/sh\ncase "$2" in\n${cases}\n  *) echo ;;\nesac\n`);
    await chmod(path, 0o755);
    return path;
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'myleaf-kpathsea-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns the variables kpsewhich has values for', async () => {
    const kpsewhich = await fakeKpsewhich('tl', {
      TEXMFCNF: '{/tl/bin,/tl/texmf-dist/web2c}',
      TEXMFROOT: '/tl',
    });
    expect(await kpathseaEnv(kpsewhich)).toEqual({
      TEXMFCNF: '{/tl/bin,/tl/texmf-dist/web2c}',
      TEXMFROOT: '/tl',
    });
  });

  it('returns null without TEXMFCNF or kpsewhich', async () => {
    expect(await kpathseaEnv(await fakeKpsewhich('none', { TEXMFROOT: '/tl' }))).toBeNull();
    expect(await kpathseaEnv(join(dir, 'missing'))).toBeNull();
  });
});
