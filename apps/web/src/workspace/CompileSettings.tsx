import type { ProjectSettings } from '@myleaf/project';

interface CompileSettingsProps {
  readonly settings: ProjectSettings;
  readonly liveAvailable: boolean;
  /** Live preview is on and available. */
  readonly livePreviewOn: boolean;
  readonly onChange: (settings: Partial<ProjectSettings>) => void;
}

/** Checkboxes in the Recompile dropdown. */
export function CompileSettings({
  settings,
  liveAvailable,
  livePreviewOn,
  onChange,
}: CompileSettingsProps) {
  return (
    <>
      <label>
        <input
          type="checkbox"
          checked={settings.autoCompile}
          onChange={(event) => onChange({ autoCompile: event.target.checked })}
        />
        <span>
          Auto-compile
          <small>After a 1 s pause in typing</small>
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
      <label title={liveAvailable ? undefined : 'Not enabled on this server'}>
        <input
          type="checkbox"
          disabled={!liveAvailable}
          checked={livePreviewOn}
          onChange={(event) => onChange({ livePreview: event.target.checked })}
        />
        <span>
          Live preview (XeLaTeX)
          <small>
            {liveAvailable
              ? 'Pages update as you type; may differ from the pdfLaTeX PDF'
              : 'Not enabled on this server'}
          </small>
        </span>
      </label>
    </>
  );
}
