import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ProjectId } from '@myleaf/doc-model';
import type { LivePreviewEvent, LivePreviewSession } from '@myleaf/live-preview';
import { parseProjectPath } from '@myleaf/project';
import type { ProjectFile } from '@myleaf/project';
import * as mupdf from 'mupdf';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { kpathseaEnv } from './kpathsea-env.js';
import { pauseOffset } from './pause-offset.js';
import { PdftexLivePreview } from './pdftex-live-preview.js';

const encoder = new TextEncoder();
const images = new WeakMap<Uint8Array, string>();
/** What a one-page PDF shows: its rendering at 72 dpi, as base64 PNG. */
const look = (pdf: Uint8Array): string => {
  let image = images.get(pdf);
  if (image === undefined) {
    const document = new mupdf.PDFDocument(pdf);
    const pixmap = document
      .loadPage(0)
      .toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false);
    image = Buffer.from(pixmap.asPNG()).toString('base64');
    pixmap.destroy();
    document.destroy();
    images.set(pdf, image);
  }
  return image;
};
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
const available = process.platform !== 'win32' && existsSync(command) && kpathsea !== null;

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

  const open = async (
    files: ProjectFile[],
    root = workRoot,
    options: { tailDelayMs?: number; trace?: (line: string) => void } = {},
  ) => {
    events = [];
    const backend = new PdftexLivePreview({
      command,
      workRoot: root,
      kpathsea: kpathsea ?? {},
      ...options,
    });
    session = await backend.open(
      { projectId: ProjectId('p'), rootFile: parseProjectPath('main.tex'), files },
      (event) => events.push(event),
    );
    return session;
  };
  const pages = () =>
    events.flatMap((event) =>
      event.type === 'page' && 'pdf' in event
        ? [{ page: event.page, pdf: event.pdf, image: look(event.pdf) }]
        : [],
    );
  const mainFile = (content: Uint8Array): ProjectFile => ({
    path: parseProjectPath('main.tex'),
    content,
  });
  /** Waits until no event arrived for a second (reruns for the .aux included). */
  const settled = () =>
    expect
      .poll(
        async () => {
          const before = events.length;
          await new Promise((done) => setTimeout(done, 1000));
          return events.length === before;
        },
        { timeout: 30_000 },
      )
      .toBe(true);

  it('shows the requested pages and re-emits only pages that change', async () => {
    const live = await open([mainFile(main('', 'First page.'))]);
    live.showPages(1, 2);
    await expect
      .poll(() => events, { timeout: 20_000 })
      .toContainEqual({ type: 'page-count', count: 2, final: true });
    await expect.poll(() => pages().length, { timeout: 20_000 }).toBe(2);
    const [first] = pages();
    expect(Buffer.from(first!.pdf.subarray(0, 5)).toString()).toBe('%PDF-');

    live.updateFile(mainFile(main('', 'First page, edited with more words.')));
    await expect.poll(() => pages().length, { timeout: 20_000 }).toBe(3);
    expect(pages()[2]?.page).toBe(1);
    expect(pages()[2]?.image).not.toBe(first?.image);
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
    expect(pages()[1]?.image).not.toBe(pages()[0]?.image);
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
    expect(new Set(pages().map((page) => page.image)).size).toBe(3);
  });

  it('brings references up to date without an edit', async () => {
    const live = await open([
      mainFile(main('', String.raw`\section{One}\label{one} See section~\ref{one}.`)),
    ]);
    live.showPages(1, 1);
    // The first run has no .aux (section ??); a new engine reads the one it
    // wrote, and the page is typeset again.
    await expect.poll(() => pages().length, { timeout: 20_000 }).toBe(2);
    expect(pages()[1]?.image).not.toBe(pages()[0]?.image);
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
      const shown = () => fresh.find((event) => event.type === 'page' && event.page === page);
      await expect.poll(shown, { timeout: 30_000 }).toBeDefined();
      return look((shown() as { pdf: Uint8Array }).pdf);
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
    expect(pages()[1]?.image).toBe(await freshPage(third, 3));
    expect(pages()[2]?.image).toBe(await freshPage(edited, 3));
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
    expect(pages()[1]?.image).toBe(await freshPage([root, third], 3));
    expect(pages()[2]?.image).toBe(await freshPage([root, edited], 3));
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
    expect(pages().at(-1)?.image).toBe(
      await freshPage(threePages('First page, edited.', 'Third page, edited.'), 3),
    );
  });

  it('marks the pages a run typesets again as stale until they are shown or unchanged', async () => {
    const live = await open([mainFile(threePages('First page.', 'Third page.'))]);
    live.showPages(1, 3);
    const shown = () => pages().map((page) => page.page);
    const unchanged = () =>
      events.flatMap((event) => (event.type === 'page-unchanged' ? [event.page] : []));
    await settled();
    expect(events[0]).toEqual({ type: 'stale', from: 1 });
    expect(new Set(shown())).toEqual(new Set([1, 2, 3]));

    // An edit on page 3 resumes from the snapshot after page 2: pages 1 and 2
    // are rendered again from the run's PDF and reported unchanged (page 3
    // too, after the run).
    events = [];
    live.updateFile(mainFile(threePages('First page.', 'Third page, edited.')));
    await settled();
    expect(events.filter((event) => event.type === 'stale')).toEqual([{ type: 'stale', from: 3 }]);
    expect(shown()).toEqual([3]);
    expect(unchanged()).toEqual(expect.arrayContaining([1, 2]));

    // An edit on page 1 starts from the engine: every page is typeset again.
    events = [];
    live.updateFile(mainFile(threePages('First page, edited.', 'Third page, edited.')));
    await settled();
    expect(events.filter((event) => event.type === 'stale')).toEqual([{ type: 'stale', from: 1 }]);
    expect(shown()).toEqual([1]);
    expect(unchanged()).toEqual(expect.arrayContaining([2, 3]));
    expect(events.some((event) => event.type === 'page' && event.stale)).toBe(false);
  });

  it('brings pages shown before, outside the visible range, up to date after a run', async () => {
    const live = await open([mainFile(threePages('First page.', 'Third page.'))]);
    live.showPages(1, 3);
    await settled();
    // Only page 1 is visible now; the browser still holds pages 2 and 3.
    live.showPages(1, 1);
    const unchanged = () =>
      events.flatMap((event) => (event.type === 'page-unchanged' ? [event.page] : []));

    // An edit on page 1 makes every page stale; after the run, pages 2 and 3
    // are reported unchanged without being scrolled to.
    events = [];
    live.updateFile(mainFile(threePages('First page, edited.', 'Third page.')));
    await settled();
    expect(events.filter((event) => event.type === 'stale')).toEqual([{ type: 'stale', from: 1 }]);
    expect(unchanged()).toEqual(expect.arrayContaining([2, 3]));

    // An edit on page 3, off screen: its new image is sent, not stale.
    events = [];
    live.updateFile(mainFile(threePages('First page, edited.', 'Third page, edited.')));
    await settled();
    expect(pages().map((page) => page.page)).toEqual([3]);
    expect(events.some((event) => event.type === 'page' && event.stale)).toBe(false);
    expect(pages()[0]?.image).toBe(
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
    expect(pages()[1]?.image).toBe(await freshPage([root, extra], 3));
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
    expect(pages()[1]?.image).not.toBe(pages()[0]?.image);
  });

  it('maps between the source and the pages of the last run with SyncTeX', async () => {
    const doc = (second: string) =>
      bytes(String.raw`\documentclass{article}
\begin{document}
First page.
\input{part}
\newpage
${second}
\end{document}
`);
    const part = { path: parseProjectPath('part.tex'), content: bytes('Text from part.\n') };
    const live = await open([mainFile(doc('Second page.')), part]);
    const forward = (file: string, line: number) =>
      live.forwardSearch!({ file: parseProjectPath(file), line, column: null });
    const inverse = async (file: string, line: number) => {
      const [rect] = await forward(file, line);
      return rect
        ? live.inverseSearch!({
            page: rect.page,
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
          })
        : null;
    };
    expect(await forward('main.tex', 3)).toEqual([]);
    live.showPages(1, 2);
    await settled();
    expect(events).toContainEqual({ type: 'page-count', count: 2, final: true });
    const pagesOf = async (file: string, line: number) =>
      new Set((await forward(file, line)).map((rect) => rect.page));
    expect(await pagesOf('main.tex', 3)).toEqual(new Set([1]));
    expect(await pagesOf('part.tex', 1)).toEqual(new Set([1]));
    expect(await pagesOf('main.tex', 6)).toEqual(new Set([2]));
    expect(await inverse('main.tex', 6)).toEqual({
      file: parseProjectPath('main.tex'),
      line: 6,
      column: null,
    });
    expect(await inverse('part.tex', 1)).toMatchObject({ file: parseProjectPath('part.tex') });

    // A run that resumes after page 1 gives SyncTeX data for the whole document.
    live.updateFile(mainFile(doc('Inserted.\n\nSecond page.')));
    await settled();
    expect(await pagesOf('main.tex', 3)).toEqual(new Set([1]));
    expect(await pagesOf('part.tex', 1)).toEqual(new Set([1]));
    expect(await pagesOf('main.tex', 8)).toEqual(new Set([2]));
    expect(await inverse('main.tex', 8)).toMatchObject({ line: 8 });
  });

  it('does not send a page again when only objects written at the end differ', async () => {
    // Like PGF: page resources refer to an object written at the end of the
    // document, so the PDF that shows page 1 first lacks it.
    const live = await open([
      mainFile(
        bytes(String.raw`\documentclass{article}
\pdfobj reserveobjnum \edef\gs{\the\pdflastobj}
\edef\x{/ExtGState \gs\space 0 R}\expandafter\pdfpageresources\expandafter{\x}
\AtEndDocument{\immediate\pdfobj useobjnum \gs {<<>>}}
\begin{document}
First page.
\newpage
Second page.
\end{document}
`),
      ),
    ]);
    live.showPages(1, 1);
    await settled();
    expect(pages().map((page) => page.page)).toEqual([1]);
    expect(events).toContainEqual({ type: 'page-unchanged', page: 1 });
  });

  it('pauses the rest of a run until edits stop or the visible pages move past it', async () => {
    const long = (first: string) =>
      mainFile(
        bytes(String.raw`\documentclass{article}
\begin{document}
${first}
\count255=0 \loop\advance\count255 by 1 \ifnum\count255<60 \newpage Page \the\count255. \repeat
\end{document}
`),
      );
    const delay = 4000;
    const trace: string[] = [];
    const live = await open([long('First.')], workRoot, {
      tailDelayMs: delay,
      trace: (line) => trace.push(line),
    });
    live.showPages(1, 1);
    const finalCount = () =>
      events.find((event) => event.type === 'page-count' && event.final) ?? null;
    await expect.poll(finalCount, { timeout: 30_000 }).not.toBeNull();
    await settled();

    // After an edit, page 1 comes at once and the rest after `delay`.
    events = [];
    let start = performance.now();
    live.updateFile(long('First, edited.'));
    await expect.poll(() => pages().length, { timeout: 20_000 }).toBe(1);
    expect(trace.some((line) => / pause run \d+ /.test(line))).toBe(true);
    await expect.poll(finalCount, { timeout: 20_000 }).toEqual({
      type: 'page-count',
      count: 60,
      final: true,
    });
    expect(performance.now() - start).toBeGreaterThanOrEqual(delay - 100);
    await settled();

    // Scrolling past the paused run's last page lets it go on at once.
    events = [];
    start = performance.now();
    live.updateFile(long('First, edited again.'));
    await expect.poll(() => pages().length, { timeout: 20_000 }).toBe(1);
    live.showPages(40, 40);
    await expect.poll(finalCount, { timeout: 20_000 }).not.toBeNull();
    expect(performance.now() - start).toBeLessThan(delay - 1000);
    expect(pages().map((page) => page.page)).toContain(40);
  });

  it('counts the pages of a run in a workspace with a long path', async () => {
    // pdfTeX wraps log lines at 79 characters by default. A root this long
    // puts a line break in "(2 pages" of the log's last line, "Output written
    // on <root>/p/<session>/runs/1/main.pdf (2 pages, ...".
    const length = 79 + ((((2 - workRoot.length - 1) % 79) + 79) % 79);
    const root = join(workRoot, 'x'.repeat(length));
    const live = await open([mainFile(main('', 'First page.'))], root);
    live.showPages(1, 2);
    await expect
      .poll(() => events, { timeout: 20_000 })
      .toContainEqual({ type: 'page-count', count: 2, final: true });
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
