import type { FileEntryDto } from '@myleaf/api';
import type { ProjectId } from '@myleaf/doc-model';
import { macroDefinitions } from '@myleaf/latex-syntax';
import type { MacroDefinitions } from '@myleaf/latex-syntax';
import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

const NO_MACROS: MacroDefinitions = {};
const SOURCE = /\.(tex|sty)$/i;

/**
 * Macros defined in the project's `.tex` and `.sty` files other than the open
 * one (whose definitions visual mode reads live), as saved on the server.
 * Loaded only while `enabled`; refreshed when the file list or the open file
 * changes.
 */
export function useProjectMacros(
  projectId: ProjectId,
  files: readonly FileEntryDto[],
  openPath: string | null,
  enabled: boolean,
): MacroDefinitions {
  const [macros, setMacros] = useState<MacroDefinitions>(NO_MACROS);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const sources = files.filter((file) => SOURCE.test(file.path) && file.path !== openPath);
    void Promise.all(
      sources.map((file) =>
        api.readFile(projectId, file.path).then(
          (bytes) => macroDefinitions(new TextDecoder().decode(bytes)),
          () => NO_MACROS,
        ),
      ),
    ).then((found) => {
      if (!cancelled) setMacros(Object.assign({}, ...found) as MacroDefinitions);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, files, openPath, projectId]);

  return enabled ? macros : NO_MACROS;
}
