import { describe, expect, it } from 'vitest';
import {
  AUTO_COMPILE_DELAY_MAX,
  DEFAULT_SETTINGS,
  FONT_SIZE_MAX,
  LINE_HEIGHT_MIN,
  formatSeconds,
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
      autoCompileDelay: 2500,
      autoCompilePasses: 'full',
      compileOnLiveOff: false,
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
    const parsed = parseSettings(
      '{"editorFontSize":100,"editorLineHeight":0.2,"autoCompileDelay":60000}',
    );
    expect(parsed.editorFontSize).toBe(FONT_SIZE_MAX);
    expect(parsed.editorLineHeight).toBe(LINE_HEIGHT_MIN);
    expect(parsed.autoCompileDelay).toBe(AUTO_COMPILE_DELAY_MAX);
  });

  it('ignores unknown auto-compile passes', () => {
    expect(parseSettings('{"autoCompilePasses":"triple"}').autoCompilePasses).toBe('single');
  });
});

describe('formatSeconds', () => {
  it('shows seconds without trailing zeros', () => {
    expect(formatSeconds(1000)).toBe('1 s');
    expect(formatSeconds(500)).toBe('0.5 s');
    expect(formatSeconds(2250)).toBe('2.25 s');
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
