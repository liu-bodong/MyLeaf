/**
 * Level 2 of pdfLaTeX speed (docs/spikes/pdflatex-live-preview.md): the
 * patched pdfTeX (vendor/pdftex) pauses in the main file and forks a child
 * per edit. Measures the time from sending an edit to the child's PDF on the
 * benchmark paper, against a full run of the same binary, for two pause
 * points: before the `\begin{document}` line, and after it (what
 * packages/live-pdftex uses), and, after it, the time to a page shown page
 * by page (level 3).
 * Build first with `vendor/pdftex/build.sh`, then run `pnpm bench:pdftex-warm`.
 * Set PDFTEX to use another binary and BENCH_RUNS to change repetitions.
 */
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';

const RUNS = Number(process.env.BENCH_RUNS ?? 11);
/** Pages shown page by page (level 3); the benchmark paper has 8. */
const SHOWN_PAGES = [1, 3, 8];
const LAST_PAGE = 8;
const pdftex =
  process.env.PDFTEX ??
  fileURLToPath(new URL('../../../vendor/pdftex/build/bin/pdftex', import.meta.url));
// The patched binary is not installed with TeX Live: point kpathsea at the
// installed TeX Live's files (as packages/live-pdftex's kpathseaEnv does).
const kpathsea = Object.fromEntries(
  ['TEXMFCNF', 'TEXMFROOT', 'TEXMFLOCAL']
    .map((name): [string, string] => [
      name,
      execFileSync('kpsewhich', ['-var-value', name], { encoding: 'utf8' }).trim(),
    ])
    .filter(([, value]) => value !== ''),
);
const env = { ...process.env, ...kpathsea };

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

const paper = await readFile(new URL('paper.tex', import.meta.url), 'utf8');
// T0 marks when the engine has run the \\begin{document} line, just before it
// pauses after it (`ready`); see `timed` below.
const base = paper.replace(
  '\\begin{document}\n',
  '\\begin{document}\\immediate\\write16{MYLEAF-T0 \\the\\pdfelapsedtime}\n',
);
const beginLine = base.indexOf('\\begin{document}\\immediate');
if (beginLine < 0 || base.lastIndexOf('\n', beginLine - 1) !== beginLine - 1) {
  throw new Error('paper.tex must have \\begin{document} alone on a line');
}
const pausePoints = [
  {
    name: 'before the \\begin{document} line',
    offset: Buffer.byteLength(base.slice(0, beginLine)),
  },
  {
    name: 'after the \\begin{document} line',
    offset: Buffer.byteLength(base.slice(0, base.indexOf('\n', beginLine) + 1)),
  },
];
const oneLine = `${base.slice(0, base.indexOf('\n', beginLine) + 1)}One line.\n\\end{document}\n`;
// For the breakdown of a forked child: pdfTeX's \pdfelapsedtime counts from
// the engine's start (the child inherits it), in 1/65536 s. T1 is written
// when the body starts, T2 at the end of \end{document}, before pdfTeX
// writes the rest of the PDF (fonts, cross-reference table) and exits.
const bodyStart = base.indexOf('\n', beginLine) + 1;
const timed = (edit: string) =>
  `${base.slice(0, bodyStart)}\\immediate\\write16{MYLEAF-T1 \\the\\pdfelapsedtime}%
\\AddToHook{enddocument/end}{\\immediate\\write16{MYLEAF-T2 \\the\\pdfelapsedtime}}%
${base.slice(bodyStart).replace('Lorem ipsum', edit)}`;

const work = await mkdtemp(join(tmpdir(), 'myleaf-pdftex-warm-'));
try {
  execFileSync(
    pdftex,
    ['-ini', '-jobname=pdflatex', '-progname=pdflatex', '-etex', 'pdflatex.ini'],
    { cwd: work, env, stdio: 'ignore' },
  );
  await writeFile(join(work, 'main.tex'), base);
  const args = ['-fmt=pdflatex', '-progname=pdflatex', '-interaction=nonstopmode', 'main.tex'];
  const fullEnv = { ...env, TEXFORMATS: `${work}:` };
  // A full run first, so main.aux exists as after the authoritative compile.
  execFileSync(pdftex, args, { cwd: work, env: fullEnv, stdio: 'ignore' });

  const full: number[] = [];
  const ref = join(work, 'full');
  await mkdir(ref);
  await copyFile(join(work, 'main.aux'), join(ref, 'main.aux'));
  await writeFile(join(ref, 'main.tex'), base.replace('Lorem ipsum', 'Lorem ipsum 0'));
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    execFileSync(pdftex, args, { cwd: ref, env: fullEnv, stdio: 'ignore' });
    full.push(performance.now() - start);
  }

  const measure = async (pauseAt: number, tag: string) => {
    // The engine writes to its own directory: at \\begin{document} it opens
    // main.aux for writing, which must not truncate the one in `work`.
    const engineDir = join(work, `engine-${tag}`);
    await mkdir(engineDir);
    // fd 3 is a socket pair: the engine's control descriptor.
    const start = performance.now();
    const engine = spawn(pdftex, [`-output-directory=${engineDir}`, ...args], {
      cwd: work,
      env: {
        ...fullEnv,
        MYLEAF_PDFTEX_HOOKS: '1',
        MYLEAF_PDFTEX_PAUSE_OFFSET: String(pauseAt),
        MYLEAF_PDFTEX_CONTROL_FD: '3',
      },
      stdio: ['ignore', 'ignore', 'inherit', 'pipe'],
    });
    const control = engine.stdio[3] as Duplex;
    const lines = createInterface({ input: control })[Symbol.asyncIterator]();
    // `started` and `resumed` lines (for cancelling, and for snapshots) are
    // not needed here: without snapshots the engine itself reads each `run`.
    // Nor are `read` lines (the files a run opens).
    const next = async (): Promise<string> => {
      const line = await lines.next();
      if (line.done) throw new Error('pdfTeX closed the control connection');
      return /^(started|resumed|read)\t/.test(line.value) ? next() : line.value;
    };
    let inputs = 0;
    while ((await next()) !== 'ready') inputs++;
    const ready = performance.now() - start;

    /** Milliseconds since the engine started (its \\pdfelapsedtime). */
    const sinceStart = () => performance.now() - start;
    const run = async (id: string, source: string) => {
      const main = join(work, `${tag}-${id}.tex`);
      const out = join(work, `out-${tag}-${id}`);
      await writeFile(main, source);
      await mkdir(out);
      const sent = sinceStart();
      control.write(`run\t${id}\t${main}\t${out}\n`);
      const done = await next();
      const finished = sinceStart();
      if (done !== `done\t${id}\t0`) throw new Error(`Unexpected reply: ${done}`);
      await stat(join(out, 'main.pdf'));
      return { ms: finished - sent, sent, finished, out };
    };
    // Level 3: the child forks a finisher when it ships out page `page`,
    // which closes the PDF there and says `page`; that can come before or
    // after the child's `done`.
    const runToPage = async (id: string, source: string, page: number) => {
      const main = join(work, `${tag}-${id}.tex`);
      const out = join(work, `out-${tag}-${id}`);
      await writeFile(main, source);
      await mkdir(out);
      const sent = sinceStart();
      control.write(`run\t${id}\t${main}\t${out}\t${page}\t${page}\n`);
      let shown: number | null = null;
      let finished: number | null = null;
      while (shown === null || finished === null) {
        const line = await next();
        if (line === `page\t${id}\t${page}\t${join(out, `page-${page}`)}`)
          shown = sinceStart() - sent;
        else if (line === `done\t${id}\t0`) finished = sinceStart() - sent;
        else throw new Error(`Unexpected reply: ${line}`);
      }
      await stat(join(out, `page-${page}`, 'main.pdf'));
      return { shown, finished };
    };
    // Where a forked child's time goes, from the T0, T1 and T2 marks (see
    // `base` and `timed`). T0 was written by the engine just before `ready`,
    // which converts its clock to this one.
    const breakdown = async (id: string) => {
      const { sent, finished, out } = await run(id, timed(`Lorem ipsum ${id}`));
      const log = await readFile(join(out, 'main.log'), 'latin1');
      const mark = (name: string) => {
        const value = new RegExp(`${name} (\\d+)`).exec(log)?.[1];
        if (value === undefined) throw new Error(`${name} missing from the child's log`);
        return (Number(value) * 1000) / 65536;
      };
      const offset = ready - mark('MYLEAF-T0');
      const [t1, t2] = [mark('MYLEAF-T1') + offset, mark('MYLEAF-T2') + offset];
      return { toBody: t1 - sent, body: t2 - t1, afterBody: finished - t2 };
    };
    const edits: number[] = [];
    const short: number[] = [];
    const parts: { toBody: number; body: number; afterBody: number }[] = [];
    const pages = new Map<number, { shown: number[]; finished: number[] }>(
      SHOWN_PAGES.map((page) => [page, { shown: [], finished: [] }]),
    );
    for (let i = 1; i <= RUNS; i++) {
      edits.push((await run(`edit-${i}`, base.replace('Lorem ipsum', `Lorem ipsum ${i}`))).ms);
      short.push((await run(`short-${i}`, oneLine)).ms);
      if (pauseAt === pausePoints[1]?.offset) {
        parts.push(await breakdown(`timed-${i}`));
        for (const [page, times] of pages) {
          const edit = base.replace('Lorem ipsum', `Lorem ipsum ${i}`);
          const { shown, finished } = await runToPage(`page-${page}-${i}`, edit, page);
          times.shown.push(shown);
          times.finished.push(finished);
        }
      }
    }
    control.end();
    await once(engine, 'exit');
    const split =
      parts.length === 0
        ? null
        : {
            toBody: median(parts.map((part) => part.toBody)),
            body: median(parts.map((part) => part.body)),
            afterBody: median(parts.map((part) => part.afterBody)),
          };
    const shownPages =
      parts.length === 0
        ? []
        : [...pages].map(([page, times]) => ({
            page,
            shown: median(times.shown),
            finished: median(times.finished),
          }));
    return { ready, inputs, edits: median(edits), short: median(short), split, shownPages };
  };
  /**
   * Level 3 snapshots: the run's child leaves a paused copy after each
   * shipout. An edit in the last paragraph resumes from the last snapshot
   * before it; an edit in the first paragraph starts from the engine, after
   * the driver killed the snapshots. Includes killing them and waiting for
   * `resumed` (protocol in vendor/pdftex/README.md). With `split`, the body
   * is in body.tex, which the main file `\input`s, and the edits are there.
   */
  async function measureSnapshots(pauseAt: number, split: boolean) {
    const job = split ? 'main-split' : 'main';
    const rootOf = (text: string) =>
      split ? `${text.slice(0, bodyStart)}\\input{body}\n\\end{document}\n` : text;
    const bodyOf = (text: string) => text.slice(bodyStart, text.lastIndexOf('\\end{document}'));
    if (split) {
      await writeFile(join(work, `${job}.tex`), rootOf(base));
      await writeFile(join(work, 'body.tex'), bodyOf(base));
      // As for main.tex above: the engine reads the .aux of a full run.
      execFileSync(pdftex, [...args.slice(0, -1), `${job}.tex`], {
        cwd: work,
        env: fullEnv,
        stdio: 'ignore',
      });
    }
    const engineDir = join(work, `engine-snapshots-${job}`);
    await mkdir(engineDir);
    const engine = spawn(
      pdftex,
      [`-output-directory=${engineDir}`, ...args.slice(0, -1), `${job}.tex`],
      {
        cwd: work,
        env: {
          ...fullEnv,
          MYLEAF_PDFTEX_HOOKS: '1',
          MYLEAF_PDFTEX_PAUSE_OFFSET: String(pauseAt),
          MYLEAF_PDFTEX_CONTROL_FD: '3',
          MYLEAF_PDFTEX_SNAPSHOTS: '1',
        },
        stdio: ['ignore', 'ignore', 'inherit', 'pipe'],
        detached: true,
      },
    );
    const control = engine.stdio[3] as Duplex;
    const lines = createInterface({ input: control })[Symbol.asyncIterator]();
    const next = async () => {
      const line = await lines.next();
      if (line.done) throw new Error('pdfTeX closed the control connection');
      return line.value.split('\t');
    };
    while ((await next())[0] !== 'ready');
    let reader = engine.pid!;
    /** Per snapshot: the files its run typeset, and the bytes it read of each (`file` lines). */
    type Sources = Map<string, Buffer>;
    const snaps: { pid: number; sources: Sources; reads: [string, number, boolean][] }[] = [];
    const reads = new Map<number, [string, number, boolean][]>();
    // The adapter's rule (packages/live-pdftex): the bytes read are unchanged,
    // and no more of a file read to its end.
    const holds = ({ sources, reads: read }: (typeof snaps)[number], now: Sources) =>
      read.every(([name, bytes, eof]) => {
        const before = sources.get(name);
        const after = now.get(name);
        if (!before || !after) return true; // not one of the benchmark's files
        if (after.length < bytes || (eof && after.length !== bytes)) return false;
        return before.subarray(0, bytes).equals(after.subarray(0, bytes));
      });
    const run = async (id: string, text: string) => {
      const sources: Sources = new Map([[`${job}.tex`, Buffer.from(rootOf(text), 'latin1')]]);
      if (split) sources.set('body.tex', Buffer.from(bodyOf(text), 'latin1'));
      let kept = 0;
      while (kept < snaps.length && holds(snaps[kept]!, sources)) kept++;
      const target = kept > 0 ? snaps[kept - 1]!.pid : engine.pid!;
      const start = performance.now();
      if (reader !== target) {
        for (const { pid } of snaps.splice(kept)) process.kill(pid, 'SIGKILL');
        for (;;) {
          const [kind, pid] = await next();
          if (kind === 'resumed' && Number(pid) === target) break;
        }
      }
      const main = join(work, `snap-${job}-${id}.tex`);
      const out = join(work, `out-snap-${job}-${id}`);
      await writeFile(main, sources.get(`${job}.tex`)!);
      if (split) await writeFile(join(work, 'body.tex'), sources.get('body.tex')!);
      await mkdir(out);
      control.write(`run\t${id}\t${main}\t${out}\t${LAST_PAGE}\t${LAST_PAGE}\n`);
      let shown = 0;
      let finished = 0;
      for (;;) {
        const [kind, a, b, c, d] = await next();
        if (kind === 'file') {
          const pid = Number(a);
          if (!reads.has(pid)) reads.set(pid, []);
          reads.get(pid)!.push([basename(d!), Number(b), c === '1']);
        } else if (kind === 'snapshot' && a === id) {
          snaps.push({ pid: Number(d), sources, reads: reads.get(Number(d)) ?? [] });
          reads.delete(Number(d));
        } else if (kind === 'page' && a === id) shown = performance.now() - start;
        else if (kind === 'done' && a === id) finished = performance.now() - start;
        else if (kind === 'resumed' && finished > 0) {
          reader = Number(a);
          break;
        }
      }
      await stat(join(out, `${job}.pdf`));
      return { shown, finished };
    };
    // Each edit in the last paragraph keeps the run before's first paragraph,
    // so the snapshots that run left hold for it.
    const atStart = (i: number) => base.replace('Lorem ipsum', `Lorem ipsum ${i}`);
    const atEnd = (i: number) => {
      const text = atStart(i);
      const last = text.lastIndexOf('Lorem ipsum');
      return `${text.slice(0, last)}Lorem ipsum ${i}${text.slice(last + 'Lorem ipsum'.length)}`;
    };
    const end = { shown: [] as number[], finished: [] as number[] };
    const begin = { shown: [] as number[], finished: [] as number[] };
    await run('0', atStart(0));
    for (let i = 1; i <= RUNS; i++) {
      const fromStart = await run(`start-${i}`, atStart(i));
      begin.shown.push(fromStart.shown);
      begin.finished.push(fromStart.finished);
      const fromSnapshot = await run(`end-${i}`, atEnd(i));
      end.shown.push(fromSnapshot.shown);
      end.finished.push(fromSnapshot.finished);
    }
    control.end();
    process.kill(-engine.pid!, 'SIGKILL');
    const summary = (times: { shown: number[]; finished: number[] }) => ({
      shown: median(times.shown),
      finished: median(times.finished),
    });
    return {
      'Edit in the first paragraph (from the engine, snapshots taken)': summary(begin),
      'Edit in the last paragraph (from the last snapshot before it)': summary(end),
    };
  }

  const results = [];
  for (const [index, point] of pausePoints.entries()) {
    results.push({ ...point, ...(await measure(point.offset, String(index))) });
  }

  const snapshots = {
    'the main file': await measureSnapshots(pausePoints[1]!.offset, false),
    'body.tex, which the main file \\inputs': await measureSnapshots(pausePoints[1]!.offset, true),
  };

  const version = execFileSync(pdftex, ['--version'], { encoding: 'utf8' }).split('\n')[0];
  console.log(`${version} (vendor/pdftex)\nMedian of ${RUNS} runs (ms), benchmark paper.\n`);
  for (const result of results) {
    console.log(
      `Engine start to pause ${result.name}: ${result.ready.toFixed(0)} ms (${result.inputs} files read)`,
    );
  }
  console.log('\n| Run | Time |');
  console.log('| --- | ---: |');
  console.log(`| Full run, text edit | ${median(full).toFixed(0)} |`);
  for (const result of results) {
    console.log(`| Forked child (pause ${result.name}), text edit | ${result.edits.toFixed(0)} |`);
    console.log(
      `| Forked child (pause ${result.name}), one-line body | ${result.short.toFixed(0)} |`,
    );
  }
  for (const { name, shownPages } of results) {
    if (shownPages.length === 0) continue;
    console.log(`\nForked child (pause ${name}), text edit, page by page (level 3):\n`);
    console.log('| Page shown | To its `page` message | To `done` |');
    console.log('| --- | ---: | ---: |');
    for (const { page, shown, finished } of shownPages) {
      console.log(`| ${page} | ${shown.toFixed(0)} | ${finished.toFixed(0)} |`);
    }
  }
  for (const [where, times] of Object.entries(snapshots)) {
    console.log(
      `\nSnapshots (level 3), pause after the \\begin{document} line, page ${LAST_PAGE} shown, body in ${where}:\n`,
    );
    console.log(`| Run | To page ${LAST_PAGE}'s \`page\` message | To \`done\` |`);
    console.log('| --- | ---: | ---: |');
    for (const [name, time] of Object.entries(times)) {
      console.log(`| ${name} | ${time.shown.toFixed(0)} | ${time.finished.toFixed(0)} |`);
    }
  }
  for (const { name, split } of results) {
    if (split === null) continue;
    console.log(`\nForked child (pause ${name}), text edit, by part:\n`);
    console.log('| Part | Time |');
    console.log('| --- | ---: |');
    console.log(
      `| \`run\` sent to the body's first line (fork, child start) | ${split.toBody.toFixed(0)} |`,
    );
    console.log(`| Body to the end of \\end{document} (typesetting) | ${split.body.toFixed(0)} |`);
    console.log(
      `| Rest of the PDF, child exit, \`done\` received | ${split.afterBody.toFixed(0)} |`,
    );
  }
} finally {
  await rm(work, { recursive: true, force: true });
}
