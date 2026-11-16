import type { ProjectSettings } from '@myleaf/project';
import { formatSeconds } from '../settings/settings.js';

interface CompileSettingsProps {
  readonly settings: ProjectSettings;
  /** Live preview is on and available. */
  readonly livePreviewOn: boolean;
  /** Pause in typing before auto-compile, in milliseconds (a setting). */
  readonly autoCompileDelay: number;
  readonly onChange: (settings: Partial<ProjectSettings>) => void;
}

/**
 * Checkboxes in the Recompile dropdown. Live preview has its own switch in
 * the toolbar; finer options are in the settings window.
 */
export function CompileSettings({
  settings,
  livePreviewOn,
  autoCompileDelay,
  onChange,
}: CompileSettingsProps) {
  return (
    <>
      <label title={livePreviewOn ? 'Paused while live preview is on' : undefined}>
        <input
          type="checkbox"
          // Live preview updates as you type; the saved setting returns when it is off.
          disabled={livePreviewOn}
          checked={settings.autoCompile && !livePreviewOn}
          onChange={(event) => onChange({ autoCompile: event.target.checked })}
        />
        <span>
          Auto-compile
          <small>
            {livePreviewOn
              ? 'Paused while live preview is on'
              : `After a ${formatSeconds(autoCompileDelay)} pause in typing`}
          </small>
        </span>
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings.precompilePreamble}
          onChange={(event) => onChange({ precompilePreamble: event.target.checked })}
        />
        <span>
          Precompile preamble
          <small>Faster pdfLaTeX compiles; turn off if a package misbehaves</small>
        </span>
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings.reuseImages}
          onChange={(event) => onChange({ reuseImages: event.target.checked })}
        />
        <span>
          Reuse unchanged images
          <small>Converts transparent PNGs once instead of on every pdfLaTeX compile</small>
        </span>
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings.draftImages}
          onChange={(event) => onChange({ draftImages: event.target.checked })}
        />
        <span>
          Draft images
          <small>Show images as boxes with their file name; fastest</small>
        </span>
      </label>
    </>
  );
}
