import { strToU8, zipSync } from 'fflate';
import type { Zippable } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  ArchiveTooLargeError,
  InvalidArchiveError,
  MAX_EXTRACTED_BYTES,
  MAX_ZIP_ENTRIES,
  extractProject,
} from './zip-import.js';

const DOC = '\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n';

function zip(entries: Record<string, string | Uint8Array>): Uint8Array {
  const zippable: Zippable = {};
  for (const [name, content] of Object.entries(entries)) {
    zippable[name] = typeof content === 'string' ? strToU8(content) : content;
  }
  return zipSync(zippable);
}

const paths = (zipped: Uint8Array) => extractProject(zipped).files.map((file) => file.path);

describe('extractProject', () => {
  it('reads files with their folders and contents', () => {
    const result = extractProject(
      zip({ 'paper.tex': DOC, 'figures/a.png': new Uint8Array([1, 2]) }),
    );
    expect(result.rootFile).toBe('paper.tex');
    expect(result.files.map((file) => file.path)).toEqual(['figures/a.png', 'paper.tex']);
    expect([...result.files[0]!.content]).toEqual([1, 2]);
  });

  it('removes a single top-level folder that wraps everything', () => {
    const result = extractProject(zip({ 'thesis/main.tex': DOC, 'thesis/ch/one.tex': 'x' }));
    expect(result.files.map((file) => file.path)).toEqual(['ch/one.tex', 'main.tex']);
    expect(result.rootFile).toBe('main.tex');
  });

  it('keeps folders when files sit at more than one top level', () => {
    expect(paths(zip({ 'a/main.tex': DOC, 'b.bib': '' }))).toEqual(['a/main.tex', 'b.bib']);
  });

  it('skips folder entries and macOS metadata', () => {
    const zipped = zipSync({
      'main.tex': strToU8(DOC),
      'img/': new Uint8Array(0),
      '__MACOSX/._main.tex': strToU8('junk'),
      '.DS_Store': strToU8('junk'),
      'img/.DS_Store': strToU8('junk'),
    });
    expect(paths(zipped)).toEqual(['main.tex']);
  });

  describe('main file', () => {
    it('prefers main.tex among several documents', () => {
      expect(extractProject(zip({ 'a.tex': DOC, 'main.tex': DOC })).rootFile).toBe('main.tex');
    });

    it('otherwise takes the shallowest, then alphabetical', () => {
      const zipped = zip({ 'x/a.tex': DOC, 'z.tex': DOC, 'b.tex': DOC });
      expect(extractProject(zipped).rootFile).toBe('b.tex');
    });

    it('ignores a commented-out \\documentclass and non-.tex files', () => {
      const zipped = zip({
        'notes.tex': '% \\documentclass{article}\n',
        'doc.txt': DOC,
        'sub/real.tex': DOC,
      });
      expect(extractProject(zipped).rootFile).toBe('sub/real.tex');
    });

    it('rejects a zip without a document', () => {
      expect(() => extractProject(zip({ 'chapter.tex': 'text' }))).toThrow(InvalidArchiveError);
      expect(() => extractProject(zipSync({}))).toThrow(InvalidArchiveError);
    });
  });

  describe('safety', () => {
    it.each(['../evil.tex', 'a/../../evil.tex', '/etc/evil.tex', 'C:/evil.tex', 'a\\..\\evil.tex'])(
      'rejects the unsafe entry %s',
      (name) => {
        expect(() => extractProject(zip({ 'main.tex': DOC, [name]: 'x' }))).toThrow(
          InvalidArchiveError,
        );
      },
    );

    it('rejects an entry named __proto__', () => {
      // fflate cannot write this name, so rename a same-length entry in the bytes.
      const zipped = zip({ 'main.tex': DOC, xxxxxxxxx: 'x' });
      const from = strToU8('xxxxxxxxx');
      for (let i = 0; i + from.length <= zipped.length; i += 1) {
        if (from.every((byte, j) => zipped[i + j] === byte)) zipped.set(strToU8('__proto__'), i);
      }
      expect(() => extractProject(zipped)).toThrow(InvalidArchiveError);
    });

    it('rejects data that is not a zip', () => {
      expect(() => extractProject(strToU8('not a zip'))).toThrow(InvalidArchiveError);
    });

    it('rejects too many entries', () => {
      const entries: Record<string, string> = { 'main.tex': DOC };
      for (let i = 0; i < MAX_ZIP_ENTRIES; i += 1) entries[`f${i}.txt`] = '';
      expect(() => extractProject(zip(entries))).toThrow(ArchiveTooLargeError);
    });

    it('rejects declared contents larger than the limit before inflating them', () => {
      const zipped = zipSync({ 'main.tex': strToU8(DOC), 'a.bin': new Uint8Array(1000) });
      // Declare a.bin, the second central directory entry, as larger than the limit.
      const view = new DataView(zipped.buffer);
      const headers = [];
      for (let i = 0; i + 4 <= zipped.length; i += 1) {
        if (view.getUint32(i, true) === 0x02014b50) headers.push(i);
      }
      view.setUint32(headers[1]! + 24, MAX_EXTRACTED_BYTES + 1, true);
      expect(() => extractProject(zipped)).toThrow(ArchiveTooLargeError);
    });
  });
});
