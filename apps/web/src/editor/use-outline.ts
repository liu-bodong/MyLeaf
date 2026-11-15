import type { FileEntryDto } from '@myleaf/api';
import type { ProjectId } from '@myleaf/doc-model';
import { projectOutline } from '@myleaf/latex-syntax';
import type { OutlineEntry } from '@myleaf/latex-syntax';
import type { ProjectPath } from '@myleaf/project';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';

const TEX = /\.tex$/i;
/** Pause in typing after which the outline follows the open document. */
const EDIT_DELAY_MS = 300;

const NO_SOURCES: ReadonlyMap<string, string> = new Map();

interface OpenText {
  readonly path: string;
  readonly text: string;
}

export interface Outline {
  readonly entries: readonly OutlineEntry[];
  /** Reports the open document's new text; the outline follows after a pause. */
  readonly noteEdit: (text: string) => void;
}

/**
 * Outline of the root file and the files it includes. The project's `.tex`
 * files are read as saved on the server while `enabled`, again when the
 * file list or the open file changes; the open document's text is taken
 * from the editor instead.
 */
export function useOutline(
  projectId: ProjectId,
  files: readonly FileEntryDto[],
  rootFile: ProjectPath | null,
  open: OpenText | null,
  enabled: boolean,
): Outline {
  const [saved, setSaved] = useState<ReadonlyMap<string, string>>(NO_SOURCES);
  /** The latest edit, with the document it was made to. */
  const [edited, setEdited] = useState<{ readonly base: OpenText; readonly text: string } | null>(
    null,
  );
  const editTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  const openPath = open?.path ?? null;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const sources = files.filter((file) => TEX.test(file.path));
    void Promise.all(
      sources.map((file) =>
        api.readFile(projectId, file.path).then(
          (bytes) => [file.path, new TextDecoder().decode(bytes)] as const,
          () => null,
        ),
      ),
    ).then((read) => {
      if (!cancelled) setSaved(new Map(read.filter((entry) => entry !== null)));
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, files, openPath, projectId]);

  useEffect(
    () => () => {
      if (editTimer.current !== null) clearTimeout(editTimer.current);
    },
    [],
  );

  const noteEdit = useCallback(
    (text: string) => {
      const base = openRef.current;
      if (!enabled || base === null) return;
      if (editTimer.current !== null) clearTimeout(editTimer.current);
      editTimer.current = setTimeout(() => setEdited({ base, text }), EDIT_DELAY_MS);
    },
    [enabled],
  );

  // Edits made to a document that has since been closed or reloaded are ignored.
  const currentText = open !== null && edited?.base === open ? edited.text : (open?.text ?? null);
  const entries = useMemo(() => {
    if (!enabled || rootFile === null) return [];
    return projectOutline(rootFile, (path) =>
      path === openPath && currentText !== null ? currentText : (saved.get(path) ?? null),
    );
  }, [currentText, enabled, openPath, rootFile, saved]);

  return { entries, noteEdit };
}
