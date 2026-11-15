/** Interface theme; `system` follows the operating system. */
export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

/** Per-browser preferences edited in the settings window. */
export interface Settings {
  readonly theme: ThemePreference;
  /** CSS `font-family` of the source editor. */
  readonly editorFontFamily: string;
  /** In CSS pixels. */
  readonly editorFontSize: number;
  /** Unitless CSS `line-height`. */
  readonly editorLineHeight: number;
  readonly lineNumbers: boolean;
  readonly lineWrapping: boolean;
  readonly highlightActiveLine: boolean;
}

export const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];

/** Font stacks offered in the settings window; each falls back to a generic monospace. */
export const EDITOR_FONTS: readonly { readonly label: string; readonly value: string }[] = [
  { label: 'System monospace', value: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace" },
  { label: 'JetBrains Mono', value: "'JetBrains Mono', monospace" },
  { label: 'Fira Code', value: "'Fira Code', monospace" },
  { label: 'Source Code Pro', value: "'Source Code Pro', monospace" },
  { label: 'Cascadia Code', value: "'Cascadia Code', monospace" },
  { label: 'Consolas', value: 'Consolas, monospace' },
  { label: 'Menlo', value: 'Menlo, monospace' },
  { label: 'Courier New', value: "'Courier New', monospace" },
];

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 28;
export const LINE_HEIGHT_MIN = 1;
export const LINE_HEIGHT_MAX = 2.5;

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  editorFontFamily: EDITOR_FONTS[0]!.value,
  editorFontSize: 14,
  editorLineHeight: 1.4,
  lineNumbers: true,
  lineWrapping: true,
  highlightActiveLine: true,
};

const STORAGE_KEY = 'myleaf.settings';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Reads saved settings; missing or invalid fields fall back to the defaults. */
export function parseSettings(raw: string | null): Settings {
  let value: unknown;
  try {
    value = raw === null ? null : JSON.parse(raw);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (typeof value !== 'object' || value === null) return DEFAULT_SETTINGS;
  const saved = value as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    theme: THEMES.find((theme) => theme === saved.theme) ?? d.theme,
    editorFontFamily:
      typeof saved.editorFontFamily === 'string' && saved.editorFontFamily.trim() !== ''
        ? saved.editorFontFamily
        : d.editorFontFamily,
    editorFontSize: finiteNumber(saved.editorFontSize)
      ? clamp(Math.round(saved.editorFontSize), FONT_SIZE_MIN, FONT_SIZE_MAX)
      : d.editorFontSize,
    editorLineHeight: finiteNumber(saved.editorLineHeight)
      ? clamp(saved.editorLineHeight, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX)
      : d.editorLineHeight,
    lineNumbers: bool(saved.lineNumbers, d.lineNumbers),
    lineWrapping: bool(saved.lineWrapping, d.lineWrapping),
    highlightActiveLine: bool(saved.highlightActiveLine, d.highlightActiveLine),
  };
}

/** Storage may be unavailable (private mode, blocked site data). */
export function loadSettings(): Settings {
  try {
    return parseSettings(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Not saved; the settings still apply to this page.
  }
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemDark ? 'dark' : 'light';
  return preference;
}
