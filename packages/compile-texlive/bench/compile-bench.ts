/**
 * Compile-time benchmark for TexLiveCompileBackend on an 8-page paper.
 * Run after building: `pnpm bench`. Set BENCH_RUNS to change repetitions.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TexLiveCompileBackend } from '@myleaf/compile-texlive';
import type { CompileResult } from '@myleaf/compile';
import { ProjectId } from '@myleaf/doc-model';
import { parseProjectPath } from '@myleaf/project';

const RUNS = Number(process.env.BENCH_RUNS ?? 5);
const paper = await readFile(new URL('paper.tex', import.meta.url), 'utf8');

/** Edits that need one pass (text) and two passes (a heading changes hyperref bookmarks). */
const EDITS = {
  'Text edit': (i: number) => paper.replace('Lorem ipsum', `Lorem ipsum ${i}`),
  'Heading edit': (i: number) =>
    paper.replace('\\section{Section 7}', `\\section{Section 7 v${i}}`),
};

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

async function scenario(workRoot: string, precompilePreamble: boolean) {
  const backend = new TexLiveCompileBackend({ workRoot });
  const projectId = ProjectId(`bench-${precompilePreamble ? 'cached' : 'plain'}`);
  const compile = async (source: string): Promise<CompileResult> => {
    const result = await backend.compile({
      projectId,
      rootFile: parseProjectPath('main.tex'),
      engine: 'pdflatex',
      files: [{ path: parseProjectPath('main.tex'), content: new TextEncoder().encode(source) }],
      options: { precompilePreamble },
    });
    if (!result.hasPdf) throw new Error(`Benchmark compile failed:\n${result.log.slice(-2000)}`);
    return result;
  };

  const timings: Record<string, number> = { 'First compile': (await compile(paper)).durationMs };
  await compile(paper); // waits for the background preamble build, if any
  for (const [label, edit] of Object.entries(EDITS)) {
    const durations: number[] = [];
    for (let i = 1; i <= RUNS; i++) {
      const result = await compile(edit(i));
      durations.push(result.durationMs);
      if (precompilePreamble && result.preamble !== 'reused') {
        throw new Error(`Expected the precompiled preamble to be reused, got ${result.preamble}`);
      }
    }
    timings[label] = median(durations);
  }
  timings['No change'] = (await compile(EDITS['Heading edit'](RUNS))).durationMs;
  return timings;
}

const workRoot = await mkdtemp(join(tmpdir(), 'myleaf-bench-'));
try {
  const plain = await scenario(workRoot, false);
  const cached = await scenario(workRoot, true);
  const version = execFileSync('pdflatex', ['--version'], { encoding: 'utf8' }).split('\n')[0];
  console.log(
    `${version}\nMedian of ${RUNS} runs (ms), compile only (excludes network and PDF display).\n`,
  );
  console.log('| Scenario | Plain | Precompiled preamble |');
  console.log('| --- | ---: | ---: |');
  for (const label of Object.keys(plain)) {
    console.log(`| ${label} | ${plain[label]} | ${cached[label]} |`);
  }
} finally {
  await rm(workRoot, { recursive: true, force: true });
}
