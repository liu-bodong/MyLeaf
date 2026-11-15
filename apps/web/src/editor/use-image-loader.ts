import type { FileEntryDto } from '@myleaf/api';
import type { ProjectId } from '@myleaf/doc-model';
import type { ImageLoader } from '@myleaf/editor-visual';
import { parseProjectPath } from '@myleaf/project';
import { useEffect, useMemo } from 'react';
import { api } from '../api/client.js';
import { previewType } from '../files/file-types.js';
import { resolveGraphicsPath } from './image-paths.js';

/**
 * Loads `\includegraphics` images for visual mode as object URLs, each file
 * once per file list. PDF figures resolve to null (shown as their path) for
 * now. URLs are released when the file list changes or the editor goes.
 */
export function useImageLoader(projectId: ProjectId, files: readonly FileEntryDto[]): ImageLoader {
  const loader = useMemo(() => {
    const paths = new Set<string>(files.map((file) => file.path));
    const loaded = new Map<string, Promise<string | null>>();
    const urls: string[] = [];
    const load: ImageLoader = (path) => {
      const file = resolveGraphicsPath(path, paths);
      const type = file === null ? null : previewType(file);
      if (file === null || type?.kind !== 'image') return Promise.resolve(null);
      let url = loaded.get(file);
      if (url === undefined) {
        url = api.readFile(projectId, parseProjectPath(file)).then((bytes) => {
          const objectUrl = URL.createObjectURL(
            new Blob([bytes as Uint8Array<ArrayBuffer>], { type: type.mediaType }),
          );
          urls.push(objectUrl);
          return objectUrl;
        });
        loaded.set(file, url);
      }
      return url;
    };
    return { load, release: () => urls.forEach((url) => URL.revokeObjectURL(url)) };
  }, [files, projectId]);

  useEffect(() => loader.release, [loader]);
  return loader.load;
}
