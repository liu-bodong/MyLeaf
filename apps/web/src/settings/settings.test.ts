import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  FONT_SIZE_MAX,
  LINE_HEIGHT_MIN,
  parseSettings,
  resolveTheme,
} from './settings.js';

describe('parseSettings', () => {
  it('reads saved settings', () => {
    const saved = {
      theme: 'dark',
      editorFontFamily: "'Fira Code', monospace",
      editorFontSize: 16,
      editorLineHeight: 1.6,
      lineNumbers: false,
      lineWrapping: false,
      highlightActiveLine: false,
    };
    expect(parseSettings(JSON.stringify(saved))).toEqual(saved);
  });

  it('falls back to defaults for missing or malformed data', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('[]')).toEqual(DEFAULT_SETTINGS);
    expect(
      parseSettings(
        '{"theme":"blue","editorFontFamily":"  ","editorFontSize":"big","lineNumbers":"yes"}',
      ),
    ).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps numbers to their ranges', () => {
    const parsed = parseSettings('{"editorFontSize":100,"editorLineHeight":0.2}');
    expect(parsed.editorFontSize).toBe(FONT_SIZE_MAX);
    expect(parsed.editorLineHeight).toBe(LINE_HEIGHT_MIN);
  });
});

describe('resolveTheme', () => {
  it('follows the system only for the system preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});
