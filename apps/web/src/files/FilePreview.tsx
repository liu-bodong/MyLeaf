import { useEffect, useMemo, useState } from 'react';
import { PdfViewer } from '../pdf/PdfViewer.js';
import type { PreviewType } from './file-types.js';

interface FilePreviewProps {
  readonly path: string;
  readonly bytes: Uint8Array;
  /** `null` for files that cannot be previewed. */
  readonly type: PreviewType | null;
}

const NO_HIGHLIGHTS: never[] = [];
const ignore = () => undefined;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Read-only view of a non-text file: image or PDF preview, size, and how to include it. */
export function FilePreview({ path, bytes, type }: FilePreviewProps) {
  const url = useMemo(
    () =>
      type === null
        ? null
        : URL.createObjectURL(
            new Blob([bytes as Uint8Array<ArrayBuffer>], { type: type.mediaType }),
          ),
    [bytes, type],
  );
  useEffect(() => () => (url === null ? undefined : URL.revokeObjectURL(url)), [url]);
  const [copied, setCopied] = useState(false);
  const snippet = `\\includegraphics[width=\\linewidth]{${path}}`;

  return (
    <div className="file-preview" data-testid="file-preview">
      <header>
        <span className="location">{path}</span>
        <span>{formatSize(bytes.byteLength)}</span>
        {type !== null && (
          <span className="snippet">
            <code>{snippet}</code>
            <button
              onClick={() =>
                void navigator.clipboard.writeText(snippet).then(() => setCopied(true))
              }
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </span>
        )}
      </header>
      {type?.kind === 'image' && url !== null && (
        <div className="image-preview">
          <img src={url} alt={path} />
        </div>
      )}
      {type?.kind === 'pdf' && url !== null && (
        <PdfViewer url={url} highlights={NO_HIGHLIGHTS} onInverseSearch={ignore} />
      )}
      {type === null && (
        <p className="placeholder">This file cannot be previewed or edited here.</p>
      )}
    </div>
  );
}
