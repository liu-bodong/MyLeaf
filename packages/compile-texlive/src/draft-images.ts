const BEGIN_DOCUMENT = '\\begin{document}';

/**
 * Turns on graphicx's draft mode: `\includegraphics` then draws a box of the
 * image's size with its file name, without embedding the image. `\csname`
 * makes it do nothing when graphics is not loaded.
 */
export const DRAFT_IMAGES_CODE = '\\csname Gin@drafttrue\\endcsname';

/** Index of the first `\begin{document}` outside a comment in `text`, or -1. */
function beginDocumentIndex(text: string): number {
  let lineStart = 0;
  while (lineStart < text.length) {
    let lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd < 0) lineEnd = text.length;
    // The line without its comment (an unescaped `%`).
    let end = lineEnd;
    for (let i = lineStart; i < lineEnd; i++) {
      if (text[i] === '\\') i++;
      else if (text[i] === '%') {
        end = i;
        break;
      }
    }
    const index = text.slice(lineStart, end).indexOf(BEGIN_DOCUMENT);
    if (index >= 0) return lineStart + index;
    lineStart = lineEnd + 1;
  }
  return -1;
}

/**
 * The root file with graphicx's draft mode turned on right after its first
 * `\begin{document}`, or the file unchanged without one.
 *
 * The code goes on the same line, after `\begin{document}`, so line numbers
 * (errors, SyncTeX) stay the same, the preamble stays the same (it keeps
 * matching the precompiled preamble, which `mylatexformat` dumps at
 * `\begin{document}`), and live preview's engine runs it before it pauses
 * at the next line. Passing `draft` on the command line instead does not
 * work with a precompiled preamble: `mylatexformat` skips the command line.
 */
export function withDraftImages(source: Uint8Array): Uint8Array {
  // latin1 maps each byte to one character, so string indices are byte offsets.
  const text = Buffer.from(source.buffer, source.byteOffset, source.byteLength).toString('latin1');
  const index = beginDocumentIndex(text);
  if (index < 0) return source;
  const at = index + BEGIN_DOCUMENT.length;
  return Buffer.concat([
    source.subarray(0, at),
    Buffer.from(DRAFT_IMAGES_CODE),
    source.subarray(at),
  ]);
}
