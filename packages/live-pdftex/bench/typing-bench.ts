/**
 * Simulated typing in pdfTeX live preview (packages/live-pdftex): an edit
 * every BENCH_INTERVAL ms (default 150) on page 1 of a long document (the
 * benchmark paper 12 times, about 88 pages), with pages 1 and 2 visible.
 * For each `tailDelayMs` (BENCH_TAIL_DELAYS, default "0,1000": the rest of a
 * run goes on at once, or waits until typing pauses), reports the time from
 * an edit to page 1 of a newer run, and the machine's CPU time (all
 * processes, from /proc/stat, so Linux only) while typing.
 * Build pdfTeX with `vendor/pdftex/build.sh`, then run
 * `pnpm bench:live-typing`. Use `taskset -c 0` to try fewer cores.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectId } from '@myleaf/doc-model';
import { parseProjectPath } from '@myleaf/project';
import { PdftexLivePreview, kpathseaEnv } from '@myleaf/live-pdftex';

const INTERVAL = Number(process.env.BENCH_INTERVAL ?? 150);
const EDITS = 30;
const COPIES = 12;
const delays = (process.env.BENCH_TAIL_DELAYS ?? '0,1000').split(',').map(Number);
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const command = join(repo, 'vendor/pdftex/build/bin/pdftex');
const kpathsea = await kpathseaEnv();
if (kpathsea === null) throw new Error('kpsewhich (TeX Live) was not found');

const paper = await readFile(join(repo, 'packages/compile-texlive/bench/paper.tex'), 'utf8');
const [preamble = '', rest = ''] = paper.split('\\begin{document}\n');
const body = rest.split('\\end{document}')[0] ?? '';
/** The paper COPIES times (labels kept unique), with `typed` on page 1. */
const document = (typed: string) =>
  [
    `${preamble}\\begin{document}\n`,
    body.replace('\\label{sec:1}', `\\label{sec:1}\n${typed}\n`),
    ...Array.from({ length: COPIES - 1 }, (_, copy) =>
      body.replaceAll(/\\(label|ref|cref|eqref)\{([^}]*)\}/g, `\\$1{$2-${copy}}`),
    ),
    '\\end{document}\n',
  ].join('\n');

/** CPU time of all processes so far, in ms (user, nice, system, irq, softirq). */
const cpu = () => {
  const fields = readFileSync('/proc/stat', 'utf8').split('\n')[0]!.trim().split(/\s+/).slice(1);
  const ticks = fields.map(Number);
  return (ticks[0]! + ticks[1]! + ticks[2]! + ticks[5]! + ticks[6]!) * 10;
};
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

for (const tailDelayMs of delays) {
  const workRoot = await mkdtemp(join(tmpdir(), 'myleaf-typing-bench-'));
  const lines: [number, string][] = [];
  let lastLine = performance.now();
  let lastRun = 0;
  let pages = 0;
  const backend = new PdftexLivePreview({
    command,
    workRoot,
    kpathsea,
    tailDelayMs,
    trace: (line) => {
      lastLine = performance.now();
      lines.push([lastLine, line]);
      const run = /run (\d+): engine/.exec(line);
      if (run) lastRun = Math.max(lastRun, Number(run[1]));
    },
  });
  const encoder = new TextEncoder();
  const file = (typed: string) => ({
    path: parseProjectPath('main.tex'),
    content: encoder.encode(document(typed)),
  });
  const session = await backend.open(
    {
      projectId: ProjectId('bench'),
      rootFile: parseProjectPath('main.tex'),
      files: [file('Typed')],
    },
    (event) => {
      if (event.type === 'page-count' && event.final) pages = event.count;
    },
  );
  session.showPages(1, 2);
  while (pages === 0) await sleep(100);
  const quiet = async (ms: number) => {
    while (performance.now() - lastLine < ms) await sleep(100);
  };
  await quiet(3000);

  const edits: { at: number; after: number }[] = [];
  const cpuBefore = cpu();
  const start = performance.now();
  let typed = 'Typed';
  for (let edit = 0; edit < EDITS; edit++) {
    typed += ` word${edit}`;
    edits.push({ at: performance.now(), after: lastRun });
    session.updateFile(file(typed));
    await sleep(INTERVAL);
  }
  const cpuTyping = cpu() - cpuBefore;
  const wall = performance.now() - start;
  await quiet(4000);

  const shown = lines.flatMap(([at, line]) => {
    const match = /page 1 of run (\d+): emitted/.exec(line);
    return match ? [{ at, run: Number(match[1]) }] : [];
  });
  const latencies = edits
    .map(({ at, after }) => shown.find((show) => show.at > at && show.run > after))
    .map((show, index) => (show ? show.at - edits[index]!.at : Number.NaN))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const quantile = (q: number) =>
    Math.round(latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))]!);
  console.log(
    `tailDelayMs ${tailDelayMs}: ${pages} pages, ${EDITS} edits every ${INTERVAL} ms; ` +
      `edit to page: median ${quantile(0.5)} ms, p90 ${quantile(0.9)} ms ` +
      `(${latencies.length} of ${EDITS} edits); CPU while typing ${cpuTyping} ms in ${Math.round(wall)} ms`,
  );
  await session.close();
  await rm(workRoot, { recursive: true, force: true });
}
