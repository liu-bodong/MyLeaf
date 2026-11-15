const BEGIN_DOCUMENT = '\\begin{document}';

/** The part of a line before its comment (an unescaped `%`). */
function withoutComment(line: string): string {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') i++;
    else if (line[i] === '%') return line.slice(0, i);
  }
  return line;
}

/**
 * Byte offset of the start of the line holding the first `\begin{document}`
 * outside a comment, or `null` if there is none. The engine pauses before
 * reading this byte. Any offset gives a correct result as long as the bytes
 * before it are unchanged; a later one only saves more work.
 */
export function pauseOffset(source: Uint8Array): number | null {
  // latin1 maps each byte to one character, so string indices are byte offsets.
  const text = Buffer.from(source.buffer, source.byteOffset, source.byteLength).toString('latin1');
  let lineStart = 0;
  while (lineStart < text.length) {
    let lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd < 0) lineEnd = text.length;
    if (withoutComment(text.slice(lineStart, lineEnd)).includes(BEGIN_DOCUMENT)) return lineStart;
    lineStart = lineEnd + 1;
  }
  return null;
}
