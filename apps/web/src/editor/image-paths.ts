/** pdfLaTeX's default graphics extensions, in graphicx's order (`\DeclareGraphicsExtensions`). */
const GRAPHICS_EXTENSIONS = ['.pdf', '.png', '.jpg', '.mps', '.jpeg', '.jbig2', '.jb2'];

/**
 * The project file `\includegraphics{path}` refers to, as pdfLaTeX finds it:
 * relative to the project root (where the compile runs), the path as given
 * if it names a file, otherwise with the first default extension that
 * exists. Null if no such file exists.
 */
export function resolveGraphicsPath(path: string, files: ReadonlySet<string>): string | null {
  const normalized = path.trim().replace(/^\.\//, '');
  if (files.has(normalized)) return normalized;
  for (const extension of GRAPHICS_EXTENSIONS) {
    const candidate = `${normalized}${extension}`;
    if (files.has(candidate)) return candidate;
  }
  return null;
}
