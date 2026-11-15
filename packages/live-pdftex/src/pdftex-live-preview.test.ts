import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ProjectId } from '@myleaf/doc-model';
import type { LivePreviewEvent, LivePreviewSession } from '@myleaf/live-preview';
import { parseProjectPath } from '@myleaf/project';
import type { ProjectFile } from '@myleaf/project';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { kpathseaEnv } from './kpathsea-env.js';
import { pauseOffset } from './pause-offset.js';
import { PdftexLivePreview } from './pdftex-live-preview.js';

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text);

describe('pauseOffset', () => {
  it('returns the start of the line after the one holding \\begin{document}', () => {
    const preamble = '\\documentclass{article}\n\\usepackage{x}\n';
    const begin = '\\begin{document}\n';
    expect(pauseOffset(bytes(`${preamble}${begin}Hi\n\\end{document}\n`))).toBe(
      preamble.length + begin.length,
    );
    const line = '  \\usepackage{y}\\begin{document}Hi\n';
    expect(pauseOffset(bytes(`${preamble}${line}More`))).toBe(preamble.length + line.length);
    expect(pauseOffset(bytes(`${preamble}\\begin{document}`))).toBe(preamble.length);
  });

  it('skips commented occurrences, but not escaped percent signs', () => {
    const text = '% \\begin{document}\na % b \\begin{document}\n50\\% \\begin{document}\nX\n';
    expect(pauseOffset(bytes(text))).toBe(text.indexOf('X'));
  });

  it('counts bytes, not characters', () => {
    expect(pauseOffset(bytes('% é\n\\begin{document}\nX'))).toBe(22);
  });

  it('returns null without \\begin{document}', () => {
    expect(pauseOffset(bytes('\\input{preamble}\nText\n'))).toBeNull();
  });
});

const command =
  process.env.MYLEAF_PDFTEX ??
  resolve(import.meta.dirname, '../../../vendor/pdftex/build/bin/pdftex');
const tool = (name: string, args: string[]) => {
  try {
    return execFileSync(name, args, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
};
const kpathsea = await kpathseaEnv();
const available =
  process.platform !== 'win32' &&
  existsSync(command) &&
  kpathsea !== null &&
  tool('mutool', ['-v']) !== null;

const main = (preamble: string, firstPage: string) =>
  bytes(String.raw`\documentclass{article}
${preamble}
\begin{document}
${firstPage}
\newpage
Second page.
\end{document}
`);

describe.skipIf(!available)('PdftexLivePreview', { timeout: 60_000 }, () => {
  let workRoot: string;
  let session: LivePreviewSession | undefined;
  let events: LivePreviewEvent[];

  beforeAll(async () => {
    workRoot = await mkdtemp(join(tmpdir(), 'myleaf-live-pdftex-'));
  });
  afterEach(async () => {
    await session?.close();
    session = undefined;
  });
  afterAll(async () => {
    await rm(workRoot, { recursive: true, force: true });
  });

  const open = async (files: ProjectFile[]) => {
    events = [];
    const backend = new PdftexLivePreview({ command, workRoot, kpathsea: kpathsea ?? {} });
    session = await backend.open(
      { projectId: ProjectId('p'), rootFile: parseProjectPath('main.tex'), files },
      (event) => events.push(event),
    );
    return session;
  };
  const pages = () =>
    events.flatMap((event) =>
      event.type === 'page' ? [{ page: event.page, svg: event.svg }] : [],
    );
  const mainFile = (content: Uint8Array): ProjectFile => ({
    path: parseProjectPath('main.tex'),
    content,
  });

  it('shows the requested pages and re-emits only pages that change', async () => {
    const live = await open([mainFile(main('', 'First page.'))]);
    live.showPages(1, 2);
    await expect.poll(() => pages().length, { timeout: 20_000 }).toBe(2);
    expect(events).toContainEqual({ type: 'page-count', count: 2, final: true });
    const [first] = pages();
    expect(first?.svg).toMatch(/^<svg /);

    live.updateFile(mainFile(main('', 'First page, edited with more words.')));
    await expect.poll(() => pages().length, { timeout: 20_000 }).toBe(3);
    expect(pages()[2]?.page).toBe(1);
    expect(pages()[2]?.svg).not.toBe(first?.svg);
  });

  // After page 1 the document never ends: what is shown comes from finishers.
  const endless = (text: string) =>
    bytes(String.raw`\documentclass{article}
\begin{document}
${text}
\newpage
\loop\iftrue\repeat
\end{document}
`);

  it('shows a visible page as soon as it is shipped out', async () => {
    const live = await open([mainFile(endless('First page.'))]);
    live.showPages(1, 1);
    await expect.poll(() => pages().length, { timeout: 20_000 }).toBe(1);
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'page-count', final: true }));
  });

  it('cancels the rest of a run for an edit once the visible pages are shown', async () => {
    const live = await open([mainFile(endless('Before.'))]);
    live.showPages(1, 1);
    await expect.poll(() => pages().length, { timeout: 20_000 }).toBe(1);
    live.updateFile(mainFile(endless('After the edit.')));
    await expect.poll(() => pages().length, { timeout: 20_000 }).toBe(2);
    expect(pages()[1]?.svg).not.toBe(pages()[0]?.svg);
  });

  it('starts a new engine when the preamble or a file it read changes', async () => {
    const sty = (size: string) => ({
      path: parseProjectPath('local.sty'),
      content: bytes(`\\AtBeginDocument{\\${size}}\n`),
    });
    const live = await open([mainFile(main('\\usepackage{local}', 'Text.')), sty('normalsize')]);
    live.showPages(1, 1);
    await expect.poll(() => pages().length, { timeout: 20_000 }).toBe(1);

    live.updateFile(sty('Huge'));
    await expect.poll(() => pages().length, { timeout: 20_000 }).toBe(2);

    live.updateFile(mainFile(main('\\usepackage{local}\\pagestyle{empty}', 'Text.')));
    await expect.poll(() => pages().length, { timeout: 20_000 }).toBe(3);
    expect(new Set(pages().map((page) => page.svg)).size).toBe(3);
  });

  it('brings references up to date without an edit', async () => {
    const live = await open([
      mainFile(main('', String.raw`\section{One}\label{one} See section~\ref{one}.`)),
    ]);
    live.showPages(1, 1);
    // The first run has no .aux (section ??); a new engine reads the one it
    // wrote, and the page is typeset again.
    await expect.poll(() => pages().length, { timeout: 20_000 }).toBe(2);
    expect(pages()[1]?.svg).not.toBe(pages()[0]?.svg);
  });

  // Three pages; typesetting page 1 takes a while, so a run that starts
  // over at \begin{document} is slow. A snapshot is taken when pdfTeX reads
  // more of the main file after a shipout (in blocks of 512 bytes): the
  // comment lines put the pages in different blocks.
  const padding = `%${'x'.repeat(600)}`;
  const threePages = (first: string, third: string) =>
    bytes(String.raw`\documentclass{article}
\begin{document}
\count255=0 \loop\advance\count255 by 1 \ifnum\count255<1000000 \repeat
${first}
\newpage
${padding}
Second page.
\newpage
${padding}
${third}
\end{document}
`);
  /** Page `page` from a new session of `content` (or files), typeset from the start. */
  const freshPage = async (content: Uint8Array | ProjectFile[], page: number) => {
    const fresh: LivePreviewEvent[] = [];
    const backend = new PdftexLivePreview({ command, workRoot, kpathsea: kpathsea ?? {} });
    const other = await backend.open(
      {
        projectId: ProjectId('fresh'),
        rootFile: parseProjectPath('main.tex'),
        files: content instanceof Uint8Array ? [mainFile(content)] : content,
      },
      (event) => fresh.push(event),
    );
    try {
      other.showPages(page, page);
      const svg = () => fresh.find((event) => event.type === 'page' && event.page === page);
      await expect.poll(svg, { timeout: 30_000 }).toBeDefined();
      return (svg() as { svg: string }).svg;
    } finally {
      await other.close();
    }
  };
  const timeToPages = async (
    live: LivePreviewSession,
    content: Uint8Array | ProjectFile,
    count: number,
  ) => {
    const start = performance.now();
    live.updateFile(content instanceof Uint8Array ? mainFile(content) : content);
    await expect.poll(() => pages().length, { timeout: 30_000 }).toBe(count);
    return performance.now() - start;
  };

  it('resumes from the last snapshot before an edit', async () => {
    const live = await open([mainFile(threePages('First page.', 'Third page.'))]);
    live.showPages(3, 3);
    // The first run writes the .aux; a new engine reads it and runs again.
    const finalCounts = () =>
      events.filter((event) => event.type === 'page-count' && event.final).length;
    await expect.poll(finalCounts, { timeout: 30_000 }).toBe(2);
    expect(pages()).toHaveLength(1);
    // An edit on page 3 resumes after page 2; one on page 1 starts over.
    const third = threePages('First page.', 'Third page, edited.');
    const resumed = await timeToPages(live, third, 2);
    const edited = threePages('First page, edited.', 'Third page, edited once more.');
    const startedOver = await timeToPages(live, edited, 3);
    expect(resumed).toBeLessThan(startedOver / 2);
    expect(pages()[1]?.svg).toBe(await freshPage(third, 3));
    expect(pages()[2]?.svg).toBe(await freshPage(edited, 3));
  });

  it('resumes from the last snapshot before an edit in an \\input file', async () => {
    const chapter = (first: string, third: string) => ({
      path: parseProjectPath('chapter.tex'),
      content: bytes(String.raw`${first}
\newpage
${padding}
Second page.
\newpage
${padding}
${third}
`),
    });
    const root = mainFile(
      bytes(String.raw`\documentclass{article}
\begin{document}
\count255=0 \loop\advance\count255 by 1 \ifnum\count255<1000000 \repeat
\input{chapter}
\end{document}
`),
    );
    const live = await open([root, chapter('First page.', 'Third page.')]);
    live.showPages(3, 3);
    const finalCounts = () =>
      events.filter((event) => event.type === 'page-count' && event.final).length;
    await expect.poll(finalCounts, { timeout: 30_000 }).toBe(2);
    expect(pages()).toHaveLength(1);
    const third = chapter('First page.', 'Third page, edited.');
    const resumed = await timeToPages(live, third, 2);
    const edited = chapter('First page, edited.', 'Third page, edited once more.');
    const startedOver = await timeToPages(live, edited, 3);
    expect(resumed).toBeLessThan(startedOver / 2);
    expect(pages()[1]?.svg).toBe(await freshPage([root, third], 3));
    expect(pages()[2]?.svg).toBe(await freshPage([root, edited], 3));
  });

  it('keeps at most the snapshots asked for', async () => {
    /** pdfTeX processes of this test's sessions: the engine and its snapshots, once idle. */
    const processes = () => {
      try {
        return execFileSync('pgrep', ['-f', workRoot], { encoding: 'utf8' }).trim().split('\n')
          .length;
      } catch {
        return 0; // pgrep exits with 1 when nothing matches
      }
    };
    events = [];
    const backend = new PdftexLivePreview({
      command,
      workRoot,
      kpathsea: kpathsea ?? {},
      maxSnapshots: 3,
    });
    expect(backend.maxSnapshots).toBe(3);
    const live = await backend.open(
      {
        projectId: ProjectId('p'),
        rootFile: parseProjectPath('main.tex'),
        files: [mainFile(threePages('First page.', 'Third page.'))],
        maxSnapshots: 0,
      },
      (event) => events.push(event),
    );
    session = live;
    live.showPages(3, 3);
    const finalCounts = () =>
      events.filter((event) => event.type === 'page-count' && event.final).length;
    await expect.poll(finalCounts, { timeout: 30_000 }).toBe(2);
    await expect.poll(processes, { timeout: 10_000 }).toBe(1);
    // The backend's 3: a snapshot after each page (after page 3, when
    // \end{document} reads the .aux).
    live.setMaxSnapshots?.(null);
    live.updateFile(mainFile(threePages('First page, edited.', 'Third page.')));
    await expect.poll(finalCounts, { timeout: 30_000 }).toBe(3);
    await expect.poll(processes, { timeout: 10_000 }).toBe(4);
    // Down to 1: the run resumes from the first snapshot and takes no more.
    live.setMaxSnapshots?.(1);
    live.updateFile(mainFile(threePages('First page, edited.', 'Third page, edited.')));
    await expect.poll(finalCounts, { timeout: 30_000 }).toBe(4);
    await expect.poll(processes, { timeout: 10_000 }).toBe(2);
    expect(pages().at(-1)?.svg).toBe(
      await freshPage(threePages('First page, edited.', 'Third page, edited.'), 3),
    );
  });

  it('does not resume from a snapshot after a file it did not read appeared', async () => {
    // \IfFileExists on page 1 does not open a missing file, so snapshots
    // after it cannot tell that they depend on it.
    const root = mainFile(
      threePages(
        String.raw`\IfFileExists{extra.tex}{\gdef\extra{found}}{\gdef\extra{missing}}First page.`,
        String.raw`Third page: \extra.`,
      ),
    );
    const live = await open([root]);
    live.showPages(3, 3);
    const finalCounts = () =>
      events.filter((event) => event.type === 'page-count' && event.final).length;
    await expect.poll(finalCounts, { timeout: 30_000 }).toBe(2);
    const extra = { path: parseProjectPath('extra.tex'), content: bytes('% extra\n') };
    await timeToPages(live, extra, 2);
    expect(pages()[1]?.svg).toBe(await freshPage([root, extra], 3));
  });

  it('does not resume from a snapshot that read a changed file', async () => {
    const body = (text: string) => ({ path: parseProjectPath('first.tex'), content: bytes(text) });
    const live = await open([
      mainFile(threePages('\\input{first}', 'Third page.')),
      body('First page.'),
    ]);
    live.showPages(1, 1);
    await expect.poll(() => pages().length, { timeout: 30_000 }).toBe(1);
    live.updateFile(body('First page, from another file.'));
    await expect.poll(() => pages().length, { timeout: 30_000 }).toBe(2);
    expect(pages()[1]?.svg).not.toBe(pages()[0]?.svg);
  });

  it('typesets a root file without \\begin{document} in full runs', async () => {
    const live = await open([
      mainFile(bytes('\\input{body}\n')),
      {
        path: parseProjectPath('body.tex'),
        content: bytes('\\documentclass{article}\\begin{document}Hi\\end{document}\n'),
      },
    ]);
    live.showPages(1, 1);
    await expect.poll(() => pages().length, { timeout: 20_000 }).toBe(1);
  });

  it('stops its processes and removes its workspace on close', async () => {
    const live = await open([mainFile(main('', 'Text.'))]);
    live.showPages(1, 1);
    await expect.poll(() => pages().length, { timeout: 20_000 }).toBe(1);
    await live.close();
    session = undefined;
    expect(readdirSync(join(workRoot, 'p'))).toEqual([]);
    expect(tool('pgrep', ['-f', `${workRoot}/format`])).toBeNull();
  });

  it('stops the engine of a session closed while it starts', async () => {
    const live = await open([mainFile(main('', 'Text.'))]);
    await live.close();
    session = undefined;
    // The engine may be spawned after close() returned; it must not stay.
    await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
    expect(tool('pgrep', ['-f', `${workRoot}/format`])).toBeNull();
  });
});

describe.skipIf(process.platform === 'win32')('PdftexLivePreview with a missing binary', () => {
  it('reports that the session stopped', async () => {
    const workRoot = await mkdtemp(join(tmpdir(), 'myleaf-live-pdftex-'));
    const events: LivePreviewEvent[] = [];
    const backend = new PdftexLivePreview({
      command: join(workRoot, 'no-such-pdftex'),
      workRoot,
      kpathsea: {},
    });
    const session = await backend.open(
      {
        projectId: ProjectId('missing'),
        rootFile: parseProjectPath('main.tex'),
        files: [{ path: parseProjectPath('main.tex'), content: main('', 'x') }],
      },
      (event) => events.push(event),
    );
    expect(events).toEqual([
      { type: 'stopped', reason: expect.stringContaining('could not be started') as string },
    ]);
    await session.close();
    await rm(workRoot, { recursive: true, force: true });
  });
});
