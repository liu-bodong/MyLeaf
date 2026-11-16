/**
 * Random edits to the ICML sample in pdfTeX live preview (inserted words,
 * pasted paragraphs, deleted lines; some bursts faster than the typing
 * pause, some slower; the view moves between bursts). After each burst,
 * every page the session sent is checked, by its text, against a full
 * pdflatex compile of the same source. Exits 1 on a mismatch and writes
 * the source and the session trace to the temp directory for diagnosis.
 *
 *   SEED=<n>     edit sequence (default 1)       BURSTS=<n>  (default 8)
 *   MULTI=1      each \section in its own \input file (sections/sN.tex)
 *   BBL=<file>   a bibliography (.bbl) for the document
 *
 * Build pdfTeX with `vendor/pdftex/build.sh`, then `pnpm check:live-pdftex`.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectId } from '@myleaf/doc-model';
import { parseProjectPath } from '@myleaf/project';
import { PdftexLivePreview, kpathseaEnv } from '@myleaf/live-pdftex';
import * as mupdf from 'mupdf';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const command = join(repo, 'vendor/pdftex/build/bin/pdftex');
const kpathsea = (await kpathseaEnv())!;
const sample = join(repo, 'samples/icml2027');
const others = await Promise.all(
  (await readdir(sample))
    .filter((n) => n !== 'example_paper.tex')
    .map(async (n) => ({ path: parseProjectPath(n), content: await readFile(join(sample, n)) })),
);
if (process.env.BBL)
  others.push({ path: parseProjectPath('main.bbl'), content: await readFile(process.env.BBL) });
let text = await readFile(join(sample, 'example_paper.tex'), 'utf8');
const body0 = text.indexOf('\\begin{document}') + 20;
const end0 = () => text.indexOf('\\end{document}');
let seed = Number(process.env.SEED ?? 1);
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const sleep = (ms: number) => new Promise((d) => setTimeout(d, ms));
const enc = (t: string) => new TextEncoder().encode(t);
const MULTI = Boolean(process.env.MULTI);
/** Main file plus, with MULTI, one \\input file per \\section (split at each \\section and \\appendix). */
const split = () => {
  if (!MULTI) return { main: text, parts: [] as string[] };
  const start = text.indexOf('\\section{');
  const stop = text.indexOf('\\end{document}');
  const chunks = text.slice(start, stop).split(/(?=\\section\{|\\appendix)/);
  return {
    main:
      text.slice(0, start) +
      chunks.map((_, i) => `\\input{sections/s${i}}\n`).join('') +
      text.slice(stop),
    parts: chunks,
  };
};
const files = () => {
  const { main, parts } = split();
  return [
    { path: parseProjectPath('main.tex'), content: enc(main) },
    ...parts.map((part, i) => ({
      path: parseProjectPath(`sections/s${i}.tex`),
      content: enc(part),
    })),
  ];
};
const pageText = (pdf: Uint8Array, i = 0) => {
  const doc = mupdf.Document.openDocument(pdf, 'application/pdf');
  return doc.loadPage(i).toStructuredText('').asText().replace(/\s+/g, ' ').trim();
};
const workRoot = await mkdtemp(join(tmpdir(), 'fuzz-'));
const trace: string[] = [];
const latest = new Map<number, Uint8Array>();
let count = 0;
let lastEvent = performance.now();
const backend = new PdftexLivePreview({
  command,
  workRoot,
  kpathsea,
  trace: (l) => trace.push(`${Math.round(performance.now())} ${l}`),
});
const session = await backend.open(
  {
    projectId: ProjectId('f'),
    rootFile: parseProjectPath('main.tex'),
    files: [...files(), ...others],
  },
  (e) => {
    lastEvent = performance.now();
    if (e.type === 'page' && 'pdf' in e) latest.set(e.page, e.pdf);
    if (e.type === 'page-count' && e.final) count = e.count;
  },
);
const quiet = async (ms: number) => {
  while (performance.now() - lastEvent < ms) await sleep(50);
};
session.showPages(1, 3);
while (count === 0) await sleep(50);
session.showPages(1, count);
await quiet(1500);
let failures = 0;
for (let burst = 0; burst < Number(process.env.BURSTS ?? 8); burst++) {
  const first = 1 + Math.floor(rand() * Math.max(1, count - 2));
  session.showPages(first, first + 2);
  const edits = 1 + Math.floor(rand() * 8);
  const log: string[] = [];
  for (let i = 0; i < edits; i++) {
    const at = body0 + Math.floor(rand() * (end0() - body0));
    const pos = text.lastIndexOf('\n', at) + 1;
    const r = rand();
    if (r < 0.4) {
      text = text.slice(0, pos) + `Inserted words ${burst}-${i}. ` + text.slice(pos);
      log.push(`ins@${pos}`);
    } else if (r < 0.7) {
      const len = Math.floor(rand() * 2000);
      const e = text.indexOf('\n', pos + len);
      const cut = text.slice(pos, e);
      if (
        !cut.includes('begin') &&
        !cut.includes('end{') &&
        !cut.includes('[') &&
        !cut.includes(']') &&
        !cut.includes('{')
      ) {
        text = text.slice(0, pos) + text.slice(e + 1);
        log.push(`del@${pos}+${e - pos}`);
      }
    } else {
      const para =
        '\nLorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(
          Math.floor(rand() * 20),
        ) + '\n';
      text = text.slice(0, pos) + para + text.slice(pos);
      log.push(`para@${pos}`);
    }
    for (const f of files()) session.updateFile(f);
    await sleep(rand() < 0.5 ? 100 : 450);
  }
  if (rand() < 0.5) session.showPages(1, count);
  await quiet(2500);
  // Check against a full compile.
  const dir = mkdtempSync(join(tmpdir(), 'fuzzref-'));
  cpSync(sample, dir, { recursive: true });
  if (process.env.BBL) cpSync(process.env.BBL, join(dir, 'main.bbl'));
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(dir, 'sections'), { recursive: true });
  for (const f of files()) writeFileSync(join(dir, f.path), f.content);
  writeFileSync(join(dir, 'main.aux'), readFileSync(join(workRoot, readdirSyncDeep(workRoot))));
  try {
    execFileSync('pdflatex', ['-interaction=nonstopmode', 'main.tex'], {
      cwd: dir,
      stdio: 'ignore',
    });
  } catch {
    // A broken edit still writes a PDF in nonstop mode.
  }
  const full = readFileSync(join(dir, 'main.pdf'));
  const n = mupdf.Document.openDocument(full, 'application/pdf').countPages();
  const bad: number[] = [];
  for (const [page, pdf] of latest)
    if (page <= count && (page > n || pageText(pdf) !== pageText(full, page - 1))) bad.push(page);
  console.log(
    `burst ${burst} (${log.join(' ')}), view ${first}: count ${count}/${n}, ${bad.length ? `MISMATCH pages ${bad.sort((a, b) => a - b).join(',')}` : 'ok'}`,
  );
  if (bad.length) {
    failures++;
    writeFileSync(`${tmpdir()}/fuzz-${process.env.SEED ?? 1}-${burst}.tex`, text);
  }
}
writeFileSync(`${tmpdir()}/fuzz-trace-${process.env.SEED ?? 1}.txt`, trace.join('\n'));
await session.close();
await rm(workRoot, { recursive: true, force: true });
process.exit(failures ? 1 : 0);

function readdirSyncDeep(root: string): string {
  // The session's src/main.aux.
  const [session = ''] = readdirSync(join(root, 'f'));
  return join('f', session, 'src', 'main.aux');
}
