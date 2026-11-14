/** Media types of files that can be previewed in the browser, by extension. */
const PREVIEW_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

export interface PreviewType {
  readonly kind: 'image' | 'pdf';
  readonly mediaType: string;
}

/** How a file can be previewed, or `null` if it cannot. */
export function previewType(path: string): PreviewType | null {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const mediaType = PREVIEW_TYPES[extension];
  if (mediaType === undefined || !path.includes('.')) return null;
  return { kind: mediaType === 'application/pdf' ? 'pdf' : 'image', mediaType };
}
