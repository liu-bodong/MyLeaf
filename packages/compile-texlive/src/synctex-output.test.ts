import { describe, expect, it } from 'vitest';
import { parseSynctexRecords } from './synctex-output.js';

describe('parseSynctexRecords', () => {
  it('splits repeated records and ignores text outside the result block', () => {
    const output = [
      'This is SyncTeX command line utility, version 1.5',
      'SyncTeX result begin',
      'Output:out/main.pdf',
      'Page:1',
      'h:10.5',
      'Page:2',
      'h:20',
      'SyncTeX result end',
      'Page:99',
    ].join('\n');
    expect(parseSynctexRecords(output, 'Page').map((r) => Object.fromEntries(r))).toEqual([
      { Page: '1', h: '10.5' },
      { Page: '2', h: '20' },
    ]);
  });

  it('keeps colons inside values', () => {
    const output = 'SyncTeX result begin\nOutput:x\nInput:/a/b:c.tex\nSyncTeX result end';
    expect(parseSynctexRecords(output, 'Output')[0]?.get('Input')).toBe('/a/b:c.tex');
  });
});
