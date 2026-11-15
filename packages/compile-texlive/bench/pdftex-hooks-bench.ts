/**
 * Overhead of the pdfTeX stream hooks (vendor/pdftex): compiles the benchmark
 * paper with the patched pdfTeX, hooks off and on, and prints the medians.
 * Build first with `vendor/pdftex/build.sh`, then run `pnpm bench:pdftex-hooks`.
 * Set PDFTEX to use another binary and BENCH_RUNS to change repetitions.
 */
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNS = Number(process.env.BENCH_RUNS ?? 11);
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
const baseEnv = { ...process.env, ...kpathsea };

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

const work = await mkdtemp(join(tmpdir(), 'myleaf-pdftex-hooks-'));
try {
  execFileSync(
    pdftex,
    ['-ini', '-jobname=pdflatex', '-progname=pdflatex', '-etex', 'pdflatex.ini'],
    { cwd: work, env: baseEnv, stdio: 'ignore' },
  );
  await copyFile(new URL('paper.tex', import.meta.url), join(work, 'main.tex'));

  const compile = (hooks: boolean) => {
    const env = hooks ? { ...baseEnv, MYLEAF_PDFTEX_HOOKS: '1' } : baseEnv;
    const start = performance.now();
    execFileSync(
      pdftex,
      ['-fmt=pdflatex', '-progname=pdflatex', '-interaction=nonstopmode', 'main.tex'],
      { cwd: work, env: { ...env, TEXFORMATS: `${work}:` }, stdio: 'ignore' },
    );
    return performance.now() - start;
  };

  compile(false); // writes main.aux, so every timed run reads the same files
  const off: number[] = [];
  const on: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    off.push(compile(false));
    on.push(compile(true));
  }
  const version = execFileSync(pdftex, ['--version'], { encoding: 'utf8' }).split('\n')[0];
  console.log(`${version} (vendor/pdftex)\nMedian of ${RUNS} runs (ms), benchmark paper.\n`);
  console.log('| Hooks | Time |');
  console.log('| --- | ---: |');
  console.log(`| Off | ${median(off).toFixed(0)} |`);
  console.log(`| On (pass-through) | ${median(on).toFixed(0)} |`);
} finally {
  await rm(work, { recursive: true, force: true });
}
