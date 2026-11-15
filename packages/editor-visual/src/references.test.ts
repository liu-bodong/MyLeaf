import type { AuxReferences } from '@myleaf/latex-syntax';
import { describe, expect, it } from 'vitest';
import { citationText, referenceText, tagLabels } from './references.js';

const references: AuxReferences = {
  labels: {
    'sec:a': { number: '2.3', page: '4', type: 'subsection' },
    'fig:b': { number: '1', page: '5', type: 'figure' },
    'eq:c': { number: '7', page: '6', type: 'equation' },
    plain: { number: '3', page: '1', type: null },
  },
  citations: {
    knuth: { number: '1', year: '1984', authors: 'Knuth' },
    duda: { number: '2', year: '2000', authors: 'Duda et al.' },
    numeric: { number: '9', year: null, authors: null },
  },
};

describe('referenceText', () => {
  it('shows numbers, pages and cleveref names', () => {
    expect(referenceText('ref', 'sec:a', references)).toEqual({ text: '2.3', missing: false });
    expect(referenceText('pageref', 'fig:b', references).text).toBe('5');
    expect(referenceText('eqref', 'eq:c', references).text).toBe('(7)');
    expect(referenceText('cref', 'sec:a', references).text).toBe('section 2.3');
    expect(referenceText('Cref', 'fig:b', references).text).toBe('Fig. 1');
    expect(referenceText('cref', 'eq:c', references).text).toBe('eq. (7)');
    // No cleveref type recorded: the number alone.
    expect(referenceText('cref', 'plain', references).text).toBe('3');
  });

  it('shows ?? for labels the compile did not record, and keys without a compile', () => {
    expect(referenceText('ref', 'nope', references)).toEqual({ text: '??', missing: true });
    expect(referenceText('eqref', 'eq:c', null)).toEqual({ text: '(eq:c)', missing: false });
  });
});

describe('citationText', () => {
  it('uses author-year forms when the compile recorded them', () => {
    expect(citationText('citep', 'knuth, duda', references).text).toBe(
      '(Knuth, 1984; Duda et al., 2000)',
    );
    expect(citationText('cite', 'knuth', references).text).toBe('(Knuth, 1984)');
    expect(citationText('citet', 'knuth', references).text).toBe('Knuth (1984)');
    expect(citationText('citeauthor', 'duda', references).text).toBe('Duda et al.');
    expect(citationText('citeyear', 'duda', references).text).toBe('2000');
    expect(citationText('citealp', 'knuth,duda', references).text).toBe(
      'Knuth, 1984; Duda et al., 2000',
    );
  });

  it('uses numbers otherwise and marks unknown keys', () => {
    expect(citationText('cite', 'numeric, knuth', references).text).toBe('[9, 1]');
    expect(citationText('cite', 'nope', references)).toEqual({ text: '[?]', missing: true });
    expect(citationText('citep', 'knuth, nope', references).text).toBe('(Knuth, 1984; ?, ?)');
    expect(citationText('cite', 'numeric, nope', references)).toEqual({
      text: '[9, ?]',
      missing: true,
    });
    expect(citationText('citep', 'a, b', null)).toEqual({ text: '[a, b]', missing: false });
  });
});

describe('tagLabels', () => {
  it('turns numbered labels into tags and drops the rest', () => {
    expect(tagLabels(String.raw`x \label{eq:c} \\ y \label{none}`, references)).toBe(
      String.raw`x \tag{7} \\ y `,
    );
    expect(tagLabels(String.raw`x \label{eq:c}`, null)).toBe('x ');
  });
});
