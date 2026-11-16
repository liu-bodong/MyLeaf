import { describe, expect, it } from 'vitest';
import { choosePdftex } from './pdftex-command.js';
import type { PdftexHost } from './pdftex-command.js';

const bundled = '/repo/vendor/pdftex/build/bin/pdftex';
const host = (paths: string[], overrides: Partial<PdftexHost> = {}): PdftexHost => ({
  executable: (path) => Promise.resolve(paths.includes(path)),
  kpathsea: () => Promise.resolve({ TEXMFCNF: '/etc/texmf/web2c' }),
  ...overrides,
});

describe('choosePdftex', () => {
  it('uses the bundled build when MYLEAF_PDFTEX is not set', async () => {
    expect(await choosePdftex(undefined, bundled, host([bundled]))).toEqual({
      kind: 'enabled',
      command: bundled,
      kpathsea: { TEXMFCNF: '/etc/texmf/web2c' },
    });
    expect(await choosePdftex(undefined, bundled, host([]))).toMatchObject({
      kind: 'disabled',
      level: 'info',
    });
  });

  it('prefers MYLEAF_PDFTEX and warns when it is unusable', async () => {
    expect(await choosePdftex('/opt/pdftex', bundled, host(['/opt/pdftex']))).toMatchObject({
      kind: 'enabled',
      command: '/opt/pdftex',
    });
    expect(await choosePdftex('/opt/pdftex', bundled, host([bundled]))).toMatchObject({
      kind: 'disabled',
      level: 'warn',
    });
  });

  it('needs TeX Live', async () => {
    const noTexLive = host([bundled], { kpathsea: () => Promise.resolve(null) });
    expect(await choosePdftex(undefined, bundled, noTexLive)).toMatchObject({
      kind: 'disabled',
      reason: expect.stringContaining('kpsewhich') as string,
    });
  });
});
