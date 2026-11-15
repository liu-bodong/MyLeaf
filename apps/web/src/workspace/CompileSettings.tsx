import type { TexEngine } from '@myleaf/compile';
import type { ProjectSettings } from '@myleaf/project';
import { engineName } from '../live/engine-name.js';

interface CompileSettingsProps {
  readonly settings: ProjectSettings;
  /** The server's live-preview engine, or `null` without live preview. */
  readonly liveEngine: TexEngine | null;
  /** Live preview is on and available. */
  readonly livePreviewOn: boolean;
  readonly onChange: (settings: Partial<ProjectSettings>) => void;
}

/** Checkboxes in the Recompile dropdown. */
export function CompileSettings({
  settings,
  liveEngine,
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
    </>
  );
}
