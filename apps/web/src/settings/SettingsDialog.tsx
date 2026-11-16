import { useState } from 'react';
import type { ReactNode } from 'react';
import { Dialog } from '../ui/Dialog.js';
import {
  AUTO_COMPILE_DELAY_MAX,
  AUTO_COMPILE_DELAY_MIN,
  DEFAULT_SETTINGS,
  EDITOR_FONTS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
} from './settings.js';
import type { AutoCompilePasses, Settings, ThemePreference } from './settings.js';
import { useSettings } from './use-settings.js';

const THEME_LABELS: readonly { readonly value: ThemePreference; readonly label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const PASSES_LABELS: readonly { readonly value: AutoCompilePasses; readonly label: string }[] = [
  { value: 'single', label: 'One pass' },
  { value: 'full', label: 'Full' },
];

const CUSTOM_FONT = 'custom';

type ToggleKey = 'lineNumbers' | 'lineWrapping' | 'highlightActiveLine';

const TOGGLES: readonly { readonly key: ToggleKey; readonly label: string }[] = [
  { key: 'lineNumbers', label: 'Line numbers' },
  { key: 'lineWrapping', label: 'Wrap long lines' },
  { key: 'highlightActiveLine', label: 'Highlight the current line' },
];

interface SettingsDialogProps {
  readonly onClose: () => void;
  /** Settings of the open project, saved with it; shown after this browser's settings. */
  readonly projectSection?: ReactNode;
}

/** Settings window: appearance, editor and compile preferences, saved in this browser. */
export function SettingsDialog({ onClose, projectSection }: SettingsDialogProps) {
  const { settings, updateSettings } = useSettings();
  const preset = EDITOR_FONTS.find((font) => font.value === settings.editorFontFamily);
  const [customFont, setCustomFont] = useState(preset === undefined);

  const setNumber = (
    key: 'editorFontSize' | 'editorLineHeight',
    raw: string,
    min: number,
    max: number,
  ) => {
    const value = Number(raw);
    if (raw === '' || !Number.isFinite(value)) return;
    updateSettings({ [key]: Math.min(max, Math.max(min, value)) } satisfies Partial<Settings>);
  };

  return (
    <Dialog title="Settings" onClose={onClose}>
      <div className="settings">
        <section aria-labelledby="settings-appearance">
          <h3 id="settings-appearance">Appearance</h3>
          <div className="settings-row">
            <span id="settings-theme">Theme</span>
            <div className="segmented" role="radiogroup" aria-labelledby="settings-theme">
              {THEME_LABELS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={settings.theme === value}
                  onClick={() => updateSettings({ theme: value })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </section>
        <section aria-labelledby="settings-editor">
          <h3 id="settings-editor">Editor</h3>
          <label className="settings-row">
            <span>Font</span>
            <select
              value={customFont ? CUSTOM_FONT : (preset?.value ?? CUSTOM_FONT)}
              onChange={(event) => {
                const value = event.target.value;
                setCustomFont(value === CUSTOM_FONT);
                if (value !== CUSTOM_FONT) updateSettings({ editorFontFamily: value });
              }}
            >
              {EDITOR_FONTS.map((font) => (
                <option key={font.label} value={font.value}>
                  {font.label}
                </option>
              ))}
              <option value={CUSTOM_FONT}>Custom…</option>
            </select>
          </label>
          {customFont && (
            <label className="settings-row">
              <span>
                Custom font
                <small>A CSS font-family list; the font must be installed</small>
              </span>
              <input
                type="text"
                defaultValue={settings.editorFontFamily}
                spellCheck={false}
                onChange={(event) => {
                  const value = event.target.value.trim();
                  if (value !== '') updateSettings({ editorFontFamily: value });
                }}
              />
            </label>
          )}
          <label className="settings-row">
            <span>Font size (px)</span>
            <input
              type="number"
              min={FONT_SIZE_MIN}
              max={FONT_SIZE_MAX}
              step={1}
              defaultValue={settings.editorFontSize}
              onChange={(event) =>
                setNumber('editorFontSize', event.target.value, FONT_SIZE_MIN, FONT_SIZE_MAX)
              }
            />
          </label>
          <label className="settings-row">
            <span>Line height</span>
            <input
              type="number"
              min={LINE_HEIGHT_MIN}
              max={LINE_HEIGHT_MAX}
              step={0.1}
              defaultValue={settings.editorLineHeight}
              onChange={(event) =>
                setNumber('editorLineHeight', event.target.value, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX)
              }
            />
          </label>
          {TOGGLES.map(({ key, label }) => (
            <label key={key} className="settings-row">
              <span>{label}</span>
              <input
                type="checkbox"
                checked={settings[key]}
                onChange={(event) => updateSettings({ [key]: event.target.checked })}
              />
            </label>
          ))}
        </section>
        <section aria-labelledby="settings-compiling">
          <h3 id="settings-compiling">Compiling</h3>
          <label className="settings-row">
            <span>
              Auto-compile delay (s)
              <small>Pause in typing before auto-compile starts</small>
            </span>
            <input
              type="number"
              min={AUTO_COMPILE_DELAY_MIN / 1000}
              max={AUTO_COMPILE_DELAY_MAX / 1000}
              step={0.1}
              defaultValue={settings.autoCompileDelay / 1000}
              onChange={(event) => {
                const seconds = Number(event.target.value);
                if (event.target.value === '' || !Number.isFinite(seconds)) return;
                updateSettings({
                  autoCompileDelay: Math.round(
                    Math.min(
                      AUTO_COMPILE_DELAY_MAX,
                      Math.max(AUTO_COMPILE_DELAY_MIN, seconds * 1000),
                    ),
                  ),
                });
              }}
            />
          </label>
          <div className="settings-row">
            <span id="settings-passes">
              Auto-compile runs
              <small>One pass is faster; full also settles references and the outline</small>
            </span>
            <div className="segmented" role="radiogroup" aria-labelledby="settings-passes">
              {PASSES_LABELS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={settings.autoCompilePasses === value}
                  onClick={() => updateSettings({ autoCompilePasses: value })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <label className="settings-row">
            <span>
              Compile when live preview turns off
              <small>Brings the PDF up to date with what the live pages showed</small>
            </span>
            <input
              type="checkbox"
              checked={settings.compileOnLiveOff}
              onChange={(event) => updateSettings({ compileOnLiveOff: event.target.checked })}
            />
          </label>
        </section>
        {projectSection}
        <footer className="settings-footer">
          <small>
            Saved in this browser{projectSection === undefined ? '' : ', except This project'}.
          </small>
          <button
            type="button"
            onClick={() => {
              updateSettings(DEFAULT_SETTINGS);
              onClose();
            }}
          >
            Reset to defaults
          </button>
        </footer>
      </div>
    </Dialog>
  );
}
