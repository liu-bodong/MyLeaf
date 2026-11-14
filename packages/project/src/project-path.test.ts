import { describe, expect, it } from 'vitest';
import { InvalidProjectNameError, parseProjectName } from './project.js';
import { InvalidPathError, baseName, parseProjectPath } from './project-path.js';

describe('parseProjectPath', () => {
  it.each(['main.tex', 'chapters/intro.tex', 'a b/ü.png', '.latexmkrc', 'x..y'])(
    'accepts %j',
    (path) => {
      expect(parseProjectPath(path)).toBe(path);
    },
  );

  it.each([
    '',
    '/etc/passwd',
    '../secret',
    'a/../../b',
    'a/./b',
    'a//b',
    'dir/',
    'C:\\x',
    'a\\b',
    'a\u0000b',
    'line\nbreak',
    'x'.repeat(1025),
  ])('rejects %j', (path) => {
    expect(() => parseProjectPath(path)).toThrow(InvalidPathError);
  });

  it('returns the base name', () => {
    expect(baseName(parseProjectPath('a/b/c.tex'))).toBe('c.tex');
    expect(baseName(parseProjectPath('c.tex'))).toBe('c.tex');
  });
});

describe('parseProjectName', () => {
  it('trims names and rejects blank or overlong ones', () => {
    expect(parseProjectName('  Thesis ')).toBe('Thesis');
    expect(() => parseProjectName('   ')).toThrow(InvalidProjectNameError);
    expect(() => parseProjectName('x'.repeat(201))).toThrow(InvalidProjectNameError);
  });
});
