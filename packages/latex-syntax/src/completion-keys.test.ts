import { describe, expect, it } from 'vitest';
import {
  bibEntries,
  bibitemKeys,
  environmentNames,
  labelNames,
  stripComments,
} from './completion-keys.js';

describe('stripComments', () => {
  it('removes comments and keeps escaped percent signs', () => {
    expect(stripComments('a % c\n50\\% b % c\n\\\\% c')).toBe('a \n50\\% b \n\\\\');
  });
});

describe('labelNames', () => {
  it('finds labels outside comments, once each', () => {
    const text = '\\label{sec:intro}\n% \\label{hidden}\n\\label { fig:a }\\label{sec:intro}';
    expect(labelNames(text)).toEqual(['sec:intro', 'fig:a']);
  });
});

describe('bibitemKeys', () => {
  it('finds bibitem keys with and without an optional label', () => {
    expect(bibitemKeys('\\bibitem{knuth}\n\\bibitem[L94]{lamport}')).toEqual(['knuth', 'lamport']);
  });
});

describe('environmentNames', () => {
  it('finds defined environments and theorems', () => {
    const text =
      '\\newenvironment{note}{}{}\\renewenvironment*{quote}{}{}\\newtheorem{lemma}{Lemma}';
    expect(environmentNames(text)).toEqual(['note', 'quote', 'lemma']);
  });
});

describe('bibEntries', () => {
  it('reads keys, types and titles and skips non-entries', () => {
    const bib = [
      '@string{jacm = "J. ACM"}',
      '@comment{ignored, x}',
      '@Article{knuth84,',
      '  author = {Knuth, D.},',
      '  title = {Literate {P}rogramming},',
      '}',
      '@book(lamport94, title = "LaTeX: A Document",',
      '  year = 1994)',
      '@misc{nokey-title, year = 2020}',
    ].join('\n');
    expect(bibEntries(bib)).toEqual([
      { key: 'knuth84', type: 'article', title: 'Literate Programming' },
      { key: 'lamport94', type: 'book', title: 'LaTeX: A Document' },
      { key: 'nokey-title', type: 'misc', title: null },
    ]);
  });
});
