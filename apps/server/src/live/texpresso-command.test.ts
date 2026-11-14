import { describe, expect, it } from 'vitest';
import { chooseTexpresso } from './texpresso-command.js';

const bundled = '/repo/vendor/texpresso/build/bin/texpresso';
const existing =
  (...paths: string[]) =>
  (path: string) =>
    Promise.resolve(paths.includes(path));

describe('chooseTexpresso', () => {
  it('uses the bundled build when MYLEAF_TEXPRESSO is not set', async () => {
    expect(await chooseTexpresso(undefined, bundled, existing(bundled))).toEqual({
      kind: 'enabled',
      command: bundled,
    });
    expect(await chooseTexpresso('', bundled, existing(bundled))).toMatchObject({
      command: bundled,
    });
  });

  it('disables live preview quietly when nothing is built', async () => {
    expect(await chooseTexpresso(undefined, bundled, existing())).toMatchObject({
      kind: 'disabled',
      level: 'info',
    });
  });

  it('prefers MYLEAF_TEXPRESSO and warns when it is unusable', async () => {
    expect(await chooseTexpresso('/opt/tx', bundled, existing('/opt/tx', bundled))).toEqual({
      kind: 'enabled',
      command: '/opt/tx',
    });
    expect(await chooseTexpresso('/opt/tx', bundled, existing(bundled))).toMatchObject({
      kind: 'disabled',
      level: 'warn',
    });
  });

  it('is turned off with MYLEAF_TEXPRESSO=off', async () => {
    expect(await chooseTexpresso('off', bundled, existing(bundled))).toMatchObject({
      kind: 'disabled',
    });
  });
});
