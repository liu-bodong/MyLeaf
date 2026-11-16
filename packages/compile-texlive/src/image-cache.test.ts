import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseProjectPath } from '@myleaf/project';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImageCache, isSlowPng } from './image-cache.js';
import { withoutFilePathEntries } from './run-process.js';
import { testPng } from './test-png.js';

const hasPdftex = (() => {
  try {
    execFileSync('pdftex', ['--version'], {
      stdio: 'ignore',
      env: withoutFilePathEntries(process.env),
    });
    return true;
  } catch {
    return false;
  }
})();

describe('isSlowPng', () => {
  it('is true for PNGs pdfTeX decodes and compresses again', () => {
    expect(isSlowPng(testPng(4, 4, { colorType: 6 }))).toBe(true);
    expect(isSlowPng(testPng(4, 4, { colorType: 2, interlace: 1 }))).toBe(true);
    expect(isSlowPng(testPng(4, 4, { colorType: 2, trns: true }))).toBe(true);
  });

  it('is false for PNGs pdfTeX copies, and for other files', () => {
    expect(isSlowPng(testPng(4, 4, { colorType: 2 }))).toBe(false);
    expect(isSlowPng(new TextEncoder().encode('%PDF-1.5\n'))).toBe(false);
    expect(isSlowPng(new Uint8Array())).toBe(false);
  });
});

describe.skipIf(!hasPdftex)('ImageCache (requires pdfTeX)', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'myleaf-images-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes.slice(0, 5));

  it('converts slow PNGs once and then uses the converted copy', async () => {
    const cache = new ImageCache({ dir: join(dir, 'a') });
    const plot = { path: parseProjectPath('fig/plot.png'), content: testPng(40, 30) };
    const opaque = {
      path: parseProjectPath('photo.png'),
      content: testPng(40, 30, { colorType: 2 }),
    };
    const text = { path: parseProjectPath('main.tex'), content: new TextEncoder().encode('x') };

    const first = await cache.apply([plot, opaque, text]);
    expect(first.reused).toBe(0);
    expect(first.pending).toEqual([plot]);
    expect(first.files).toEqual([plot, opaque, text]);

    await cache.convertPending(first.pending);
    const second = await cache.apply([plot, opaque, text]);
    expect(second.reused).toBe(1);
    expect(second.pending).toEqual([]);
    expect(second.files[0]?.path).toBe('fig/plot.png');
    expect(decode(second.files[0]!.content)).toBe('%PDF-');
    expect(second.files.slice(1)).toEqual([opaque, text]);
  });

  it('does not retry images it could not convert', async () => {
    const cache = new ImageCache({ dir: join(dir, 'b') });
    const png = testPng(4, 4);
    // A valid header with a broken image after it.
    const broken = { path: parseProjectPath('broken.png'), content: png.slice(0, 40) };
    await cache.convertPending((await cache.apply([broken])).pending);
    expect(await cache.apply([broken])).toMatchObject({ reused: 0, pending: [] });
    expect((await readdir(join(dir, 'b'))).some((name) => name.endsWith('.failed'))).toBe(true);
  });
});
