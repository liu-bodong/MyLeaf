import type { ProjectId } from '@myleaf/doc-model';
import type { AuxReferences } from '@myleaf/latex-syntax';
import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

/**
 * Label and citation numbers from the latest compile, for visual mode.
 * Fetched while `enabled`, again whenever `compileVersion` changes (a
 * compile finished). Null until loaded.
 */
export function useReferences(
  projectId: ProjectId,
  compileVersion: number,
  enabled: boolean,
): AuxReferences | null {
  const [references, setReferences] = useState<AuxReferences | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api.references(projectId).then(
      (loaded) => {
        if (!cancelled) setReferences(loaded);
      },
      () => {
        // Chips keep showing keys or the previous numbers.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [compileVersion, enabled, projectId]);

  return enabled ? references : null;
}
