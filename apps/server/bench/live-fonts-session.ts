/**
 * Bytes sent for pdfTeX live pages in a scripted session on the benchmark
 * paper, through the real engine (vendor/pdftex): the pages shown are those
 * the browser asks for (two ahead), the edits type words into a paragraph,
 * some with characters the document did not use yet (new font subsets).
 * "Before" is what the page messages would weigh with their fonts inside
 * (the page without fonts plus its fonts' data); "after" is what the live
 * route sends (each font once). Needs vendor/pdftex built.
 */
import { deflateRawSync } from 'node:zlib';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { encodeLiveBinary } from '@myleaf/api';
import type { LiveBinaryMessage } from '@myleaf/api';
import { ProjectId } from '@myleaf/doc-model';
import { kpathseaEnv, PdftexLivePreview } from '@myleaf/live-pdftex';
import type { LivePreviewEvent } from '@myleaf/live-preview';
import { parseProjectPath } from '@myleaf/project';
import { LiveFonts } from '@myleaf/server';

const root = resolve(import.meta.dirname, '../../..');
const paper = await readFile(join(root, 'packages/compile-texlive/bench/paper.tex'), 'utf8');
const command = process.env.MYLEAF_PDFTEX ?? join(root, 'vendor/pdftex/build/bin/pdftex');
const work = await mkdtemp(join(tmpdir(), 'myleaf-live-fonts-'));
const kpathsea = (await kpathseaEnv()) ?? {};

const events: LivePreviewEvent[] = [];
let last = performance.now();
const backend = new PdftexLivePreview({ command, workRoot: work, kpathsea });
const path = parseProjectPath('paper.tex');
const session = await backend.open(
  { projectId: ProjectId('bench'), rootFile: path, files: [{ path, content: Buffer.from(paper) }] },
  (event) => {
    events.push(event);
    last = performance.now();
  },
);
const settle = async () => {
  await new Promise((done) => setTimeout(done, 300));
  while (performance.now() - last < 1500) await new Promise((done) => setTimeout(done, 100));
};

// Scroll through the document as the pane asks: visible page plus 1 behind, 2 ahead.
let text = paper;
const anchor = text.indexOf('\\section{Section 4}');
const edit = async (words: string) => {
  text = text.slice(0, anchor) + words + ' ' + text.slice(anchor);
  session.updateFile({ path, content: Buffer.from(text) });
  await settle();
};
session.showPages(1, 3);
await settle();
for (const first of [2, 3, 4, 5, 6]) {
  session.showPages(first - 1, first + 2);
  await settle();
}
session.showPages(2, 5);
await settle();
const editsFrom = events.length;
for (const words of [
  'lorem',
  'ipsum dolor',
  'sit amet',
  'Quixotic',
  'jazz',
  'X-ray 42',
  'Zebu!',
  'fin.',
]) {
  await edit(words);
}
await session.close();
await rm(work, { recursive: true, force: true });

const fonts = new LiveFonts();
const binary = (message: LiveBinaryMessage) => {
  const encoded = encodeLiveBinary(message);
  return { raw: encoded.length, deflated: deflateRawSync(encoded).length };
};
const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`;
const cut = (before: number, after: number) => `${Math.round((1 - after / before) * 100)}%`;
/** Replays `phase` through the connection's fonts (shared by the phases, in order). */
const replay = (name: string, phase: LivePreviewEvent[]) => {
  const sizes = { before: 0, after: 0, beforeDeflated: 0, afterDeflated: 0 };
  let pages = 0;
  let fontsSent = 0;
  let fontsSentBytes = 0;
  for (const event of phase) {
    if (event.type !== 'page' || !('pdf' in event)) continue;
    pages++;
    const pageFonts = event.fonts ?? [];
    const ids = pageFonts.map((font) => font.id);
    const page = binary({ type: 'page', page: event.page, pdf: event.pdf, fonts: ids });
    const inside = pageFonts.map((font) => binary({ type: 'font', id: font.id, data: font.data }));
    sizes.before += page.raw + inside.reduce((sum, f) => sum + f.raw, 0);
    sizes.beforeDeflated += page.deflated + inside.reduce((sum, f) => sum + f.deflated, 0);
    sizes.after += page.raw;
    sizes.afterDeflated += page.deflated;
    for (const message of fonts.send(pageFonts)) {
      if (message.type !== 'font') continue;
      const sent = binary(message);
      fontsSent++;
      fontsSentBytes += sent.raw;
      sizes.after += sent.raw;
      sizes.afterDeflated += sent.deflated;
    }
  }
  console.log(`${name}: ${pages} pages, ${fontsSent} fonts sent (${kb(fontsSentBytes)})`);
  console.log(
    `  raw: ${kb(sizes.before)} -> ${kb(sizes.after)} (${cut(sizes.before, sizes.after)} less)`,
  );
  console.log(
    `  deflated: ${kb(sizes.beforeDeflated)} -> ${kb(sizes.afterDeflated)} (${cut(sizes.beforeDeflated, sizes.afterDeflated)} less)`,
  );
};
replay('opening and scrolling', events.slice(0, editsFrom));
replay('8 edits on page 2', events.slice(editsFrom));
