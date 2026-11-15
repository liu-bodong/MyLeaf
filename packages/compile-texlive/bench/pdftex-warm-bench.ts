/**
 * Level 2 of pdfLaTeX speed (docs/spikes/pdflatex-live-preview.md): the
 * patched pdfTeX (vendor/pdftex) pauses in the main file and forks a child
 * per edit. Measures the time from sending an edit to the child's PDF on the
 * benchmark paper, against a full run of the same binary, for two pause
 * points: before the `\begin{document}` line, and after it (what
 * packages/live-pdftex uses).
 * Build first with `vendor/pdftex/build.sh`, then run `pnpm bench:pdftex-warm`.
 * Set PDFTEX to use another binary and BENCH_RUNS to change repetitions.
 */
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';

const RUNS = Number(process.env.BENCH_RUNS ?? 11);
const pdftex =
  process.env.PDFTEX ??
  fileURLToPath(new URL('../../../vendor/pdftex/build/bin/pdftex', import.meta.url));
// The patched binary has no texmf.cnf next to it; use the installed TeX Live's.
const texmfcnf = execFileSync('kpsewhich', ['-var-value', 'TEXMFCNF'], {
  encoding: 'utf8',
}).trim();
const env = { ...process.env, TEXMFCNF: texmfcnf };

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

const paper = await readFile(new URL('paper.tex', import.meta.url), 'utf8');
const beginLine = paper.indexOf('\\begin{document}\n');
if (beginLine < 0 || paper.lastIndexOf('\n', beginLine - 1) !== beginLine - 1) {
  throw new Error('paper.tex must have \\begin{document} alone on a line');
}
const pausePoints = [
  {
    name: 'before the \\begin{document} line',
    offset: Buffer.byteLength(paper.slice(0, beginLine)),
  },
  {
    name: 'after the \\begin{document} line',
    offset: Buffer.byteLength(paper.slice(0, beginLine + '\\begin{document}\n'.length)),
  },
];
const oneLine = `${paper.slice(0, beginLine)}\\begin{document}\nOne line.\n\\end{document}\n`;

const work = await mkdtemp(join(tmpdir(), 'myleaf-pdftex-warm-'));
try {
  execFileSync(
    pdftex,
    ['-ini', '-jobname=pdflatex', '-progname=pdflatex', '-etex', 'pdflatex.ini'],
    { cwd: work, env, stdio: 'ignore' },
  );
  await writeFile(join(work, 'main.tex'), paper);
  const args = ['-fmt=pdflatex', '-progname=pdflatex', '-interaction=nonstopmode', 'main.tex'];
  const fullEnv = { ...env, TEXFORMATS: `${work}:` };
  // A full run first, so main.aux exists as after the authoritative compile.
  execFileSync(pdftex, args, { cwd: work, env: fullEnv, stdio: 'ignore' });

  const full: number[] = [];
  const ref = join(work, 'full');
  await mkdir(ref);
  await copyFile(join(work, 'main.aux'), join(ref, 'main.aux'));
  await writeFile(join(ref, 'main.tex'), paper.replace('Lorem ipsum', 'Lorem ipsum 0'));
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
    const next = async () => {
      const line = await lines.next();
      if (line.done) throw new Error('pdfTeX closed the control connection');
      return line.value;
    };
    let inputs = 0;
    while ((await next()) !== 'ready') inputs++;
    const ready = performance.now() - start;

    const run = async (id: string, source: string) => {
      const main = join(work, `${tag}-${id}.tex`);
      const out = join(work, `out-${tag}-${id}`);
      await writeFile(main, source);
      await mkdir(out);
      const begin = performance.now();
      control.write(`run\t${id}\t${main}\t${out}\n`);
      const done = await next();
      const ms = performance.now() - begin;
      if (done !== `done\t${id}\t0`) throw new Error(`Unexpected reply: ${done}`);
      await stat(join(out, 'main.pdf'));
      return ms;
    };
    const edits: number[] = [];
    const short: number[] = [];
    for (let i = 1; i <= RUNS; i++) {
      edits.push(await run(`edit-${i}`, paper.replace('Lorem ipsum', `Lorem ipsum ${i}`)));
      short.push(await run(`short-${i}`, oneLine));
    }
    control.end();
    await once(engine, 'exit');
    return { ready, inputs, edits: median(edits), short: median(short) };
  };
  const results = [];
  for (const [index, point] of pausePoints.entries()) {
    results.push({ ...point, ...(await measure(point.offset, String(index))) });
  }

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
} finally {
  await rm(work, { recursive: true, force: true });
}
