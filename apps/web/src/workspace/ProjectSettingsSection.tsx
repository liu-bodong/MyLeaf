import type { ProjectSettings } from '@myleaf/project';

interface ProjectSettingsSectionProps {
  readonly settings: ProjectSettings;
  /** The server's live-preview engine name, or `null` without live preview. */
  readonly liveEngine: string | null;
  /** The server's most live-preview snapshots per session, or `null` without snapshots. */
  readonly maxSnapshots: number | null;
  readonly onChange: (settings: Partial<ProjectSettings>) => void;
}

/** The settings window's part for the open project, saved with the project. */
export function ProjectSettingsSection({
  settings,
  liveEngine,
  maxSnapshots,
  onChange,
}: ProjectSettingsSectionProps) {
  /** Saves the field's value: empty for the server's maximum, else clamped to it. */
  const commitSnapshots = (input: HTMLInputElement) => {
    if (maxSnapshots === null) return;
    const value = input.value.trim() === '' ? null : Number(input.value);
    const liveSnapshots =
      value === null || !Number.isFinite(value)
        ? null
        : Math.min(maxSnapshots, Math.max(0, Math.floor(value)));
    input.value = liveSnapshots === null ? '' : String(liveSnapshots);
    if (liveSnapshots !== settings.liveSnapshots) onChange({ liveSnapshots });
  };
  return (
    <section aria-labelledby="settings-project">
      <h3 id="settings-project">This project</h3>
      <label className="settings-row">
        <span>
          Auto-compile
          <small>Paused while live preview is on</small>
        </span>
        <input
          type="checkbox"
          checked={settings.autoCompile}
          onChange={(event) => onChange({ autoCompile: event.target.checked })}
        />
      </label>
      <label className="settings-row">
        <span>
          Precompile preamble
          <small>Faster pdfLaTeX compiles; turn off if a package misbehaves</small>
        </span>
        <input
          type="checkbox"
          checked={settings.precompilePreamble}
          onChange={(event) => onChange({ precompilePreamble: event.target.checked })}
        />
      </label>
      <label className="settings-row" title={liveEngine ? undefined : 'Not enabled on this server'}>
        <span>
          {liveEngine === null ? 'Live preview' : `Live preview (${liveEngine})`}
          <small>
            {liveEngine === null
              ? 'Not enabled on this server'
              : 'Pages update as you type; also the Live switch next to Recompile'}
          </small>
        </span>
        <input
          type="checkbox"
          disabled={liveEngine === null}
          checked={liveEngine !== null && settings.livePreview}
          onChange={(event) => onChange({ livePreview: event.target.checked })}
        />
      </label>
      {maxSnapshots !== null && (
        <label className="settings-row">
          <span>
            Live preview snapshots
            <small>
              Faster updates after an edit, about 3 MB each on the server; empty for the server's{' '}
              {maxSnapshots}
            </small>
          </span>
          <input
            // Re-created when the saved value changes, so it shows that value.
            key={String(settings.liveSnapshots)}
            type="number"
            min={0}
            max={maxSnapshots}
            placeholder={String(maxSnapshots)}
            defaultValue={settings.liveSnapshots ?? ''}
            onBlur={(event) => commitSnapshots(event.currentTarget)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitSnapshots(event.currentTarget);
            }}
          />
        </label>
      )}
    </section>
  );
}
