import type { FileEntryDto } from '@myleaf/api';
import type { ProjectId } from '@myleaf/doc-model';
import {
  bibEntries,
  bibitemKeys,
  environmentNames,
  labelNames,
  macroDefinitions,
} from '@myleaf/latex-syntax';
import type { BibEntry } from '@myleaf/latex-syntax';
import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { NO_COMPLETION_DATA } from './latex-completion.js';
import type { CompletionData } from './latex-completion.js';

const SOURCE = /\.(tex|sty|cls)$/i;
const BIB = /\.bib$/i;

/**
 * Labels, bibliography keys, commands and environments from the project's
 * files other than the open one (which completion reads live), as saved on
 * the server. Refreshed when the file list or the open file changes.
 */
export function useCompletionData(
  projectId: ProjectId,
  files: readonly FileEntryDto[],
  openPath: string | null,
): CompletionData {
  const [data, setData] = useState<CompletionData>(NO_COMPLETION_DATA);

  useEffect(() => {
    let cancelled = false;
    const read = (file: FileEntryDto) =>
      api.readFile(projectId, file.path).then(
        (bytes) => new TextDecoder().decode(bytes),
        () => '',
      );
    const others = files.filter((file) => file.path !== openPath);
    const sources = others.filter((file) => SOURCE.test(file.path));
    const bibs = others.filter((file) => BIB.test(file.path));
    void Promise.all([Promise.all(sources.map(read)), Promise.all(bibs.map(read))]).then(
      ([sourceTexts, bibTexts]) => {
        if (cancelled) return;
        const citations: BibEntry[] = bibTexts.flatMap(bibEntries);
        for (const key of sourceTexts.flatMap(bibitemKeys)) {
          citations.push({ key, type: 'bibitem', title: null });
        }
        setData({
          labels: [...new Set(sourceTexts.flatMap(labelNames))],
          citations: unique(citations),
          commands: [
            ...new Set(sourceTexts.flatMap((text) => Object.keys(macroDefinitions(text)))),
          ],
          environments: [...new Set(sourceTexts.flatMap(environmentNames))],
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [files, openPath, projectId]);

  return data;
}

/** Keeps the first entry for each key. */
function unique(entries: readonly BibEntry[]): BibEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => !seen.has(entry.key) && seen.add(entry.key));
}
