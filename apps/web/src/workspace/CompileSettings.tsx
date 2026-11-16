import type { TexEngine } from '@myleaf/compile';
import type { ProjectSettings } from '@myleaf/project';
import { engineName } from '../live/engine-name.js';

interface CompileSettingsProps {
  readonly settings: ProjectSettings;
  /** The server's live-preview engine, or `null` without live preview. */
  readonly liveEngine: TexEngine | null;
  /** Live preview is on and available. */
  readonly livePreviewOn: boolean;
  /** The server's most live-preview snapshots per session, or `null` without snapshots. */
  readonly maxSnapshots: number | null;
  readonly onChange: (settings: Partial<ProjectSettings>) => void;
}

/** Checkboxes in the Recompile dropdown. */
export function CompileSettings({
  settings,
  liveEngine,
  livePreviewOn,
  maxSnapshots,
  onChange,
}: CompileSettingsProps) {
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
            {livePreviewOn ? 'Paused while live preview is on' : 'After a 1 s pause in typing'}
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
      <label title={liveEngine ? undefined : 'Not enabled on this server'}>
        <input
          type="checkbox"
          disabled={!liveEngine}
          checked={livePreviewOn}
          onChange={(event) => onChange({ livePreview: event.target.checked })}
        />
        <span>
          {liveEngine ? `Live preview (${engineName(liveEngine)})` : 'Live preview'}
          <small>
            {liveEngine === null
              ? 'Not enabled on this server'
              : liveEngine === 'pdflatex'
                ? 'Pages update as you type'
                : 'Pages update as you type; may differ from the pdfLaTeX PDF'}
          </small>
        </span>
      </label>
      {livePreviewOn && maxSnapshots !== null && (
        <label className="compile-number">
          <input
            // Re-created when the saved value changes, so it shows that value.
            key={String(settings.liveSnapshots)}
            type="number"
            min={0}
            max={maxSnapshots}
            placeholder={String(maxSnapshots)}
            defaultValue={settings.liveSnapshots ?? ''}
            aria-label="Live preview snapshots"
            onBlur={(event) => commitSnapshots(event.currentTarget)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitSnapshots(event.currentTarget);
            }}
          />
          <span>
            Live preview snapshots
            <small>Faster updates, about 3 MB each; empty for the server's {maxSnapshots}</small>
          </span>
        </label>
      )}
    </>
  );
}
