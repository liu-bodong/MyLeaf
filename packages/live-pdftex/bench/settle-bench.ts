/**
 * How long pages stay dimmed after typing in pdfTeX live preview: the ICML
 * sample, all pages shown once (as after scrolling through), then pages
 * 1 to 3 visible and BENCH_EDITS edits every 150 ms on page 1. Reports
 * the time from the last edit until no page the browser holds is stale
 * (as the web pane tracks it) and the final page count arrived.
 * Build pdfTeX with `vendor/pdftex/build.sh`, then run `pnpm bench:live-settle`
 * (BENCH_TRACE=1 prints the session trace).
 */
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectId } from '@myleaf/doc-model';
import { parseProjectPath } from '@myleaf/project';
import { PdftexLivePreview, kpathseaEnv } from '@myleaf/live-pdftex';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const command = process.env.MYLEAF_PDFTEX ?? join(repo, 'vendor/pdftex/build/bin/pdftex');
const kpathsea = await kpathseaEnv();
if (kpathsea === null) throw new Error('kpsewhich (TeX Live) was not found');
const sample = join(repo, 'samples/icml2027');
const others = await Promise.all(
  (await readdir(sample))
    .filter((name) => name !== 'example_paper.tex')
    .map(async (name) => ({
      path: parseProjectPath(name),
      content: await readFile(join(sample, name)),
    })),
);
const paper = await readFile(join(sample, 'example_paper.tex'), 'utf8');
const marker = '\\section{Electronic Submission}';
const main = (typed: string) => ({
  path: parseProjectPath('main.tex'),
  content: new TextEncoder().encode(paper.replace(marker, `${marker}\n${typed}\n`)),
});
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const EDITS = Number(process.env.BENCH_EDITS ?? 10);

for (let round = 0; round < Number(process.env.BENCH_ROUNDS ?? 3); round++) {
  const workRoot = await mkdtemp(join(tmpdir(), 'myleaf-settle-bench-'));
  const received = new Set<number>();
  const stale = new Set<number>();
  let count = 0;
  let final = false;
  let lastEvent = performance.now();
  let settledAt = 0;
  const backend = new PdftexLivePreview({
    command,
    workRoot,
    kpathsea,
    ...(process.env.BENCH_TRACE
      ? { trace: (line: string) => console.log(Math.round(performance.now()), line) }
      : {}),
  });
  const session = await backend.open(
    {
      projectId: ProjectId('bench'),
      rootFile: parseProjectPath('main.tex'),
      files: [main('Typed'), ...others],
    },
    (event) => {
      lastEvent = performance.now();
      if (event.type === 'page') {
        received.add(event.page);
        if (event.stale) stale.add(event.page);
        else stale.delete(event.page);
      } else if (event.type === 'page-unchanged') stale.delete(event.page);
      else if (event.type === 'stale') {
        for (const page of received) if (page >= event.from) stale.add(page);
      } else if (event.type === 'page-count') {
        count = event.count;
        final = event.final;
      }
      if (final && [...stale].every((page) => page > count)) {
        if (settledAt === 0) settledAt = performance.now();
      } else settledAt = 0;
    },
  );
  session.showPages(1, 3);
  while (!final) await sleep(50);
  session.showPages(1, count);
  while (performance.now() - lastEvent < 3000) await sleep(100);
  session.showPages(1, 3);
  let typed = 'Typed';
  for (let edit = 0; edit < EDITS; edit++) {
    typed += ` word${edit}`;
    final = false;
    settledAt = 0;
    session.updateFile(main(typed));
    await sleep(150);
  }
  const last = performance.now() - 150;
  while (performance.now() - lastEvent < 4000) await sleep(100);
  const dimmed = [...stale].filter((page) => page <= count);
  console.log(
    `round ${round}: ${count} pages held ${received.size}; ` +
      (dimmed.length > 0
        ? `still dimmed after 4 s quiet: ${dimmed.join(',')}`
        : `all settled ${Math.round(settledAt - last)} ms after the last edit`),
  );
  await session.close();
  await rm(workRoot, { recursive: true, force: true });
}
