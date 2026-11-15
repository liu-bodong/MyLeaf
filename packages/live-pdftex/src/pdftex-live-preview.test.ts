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
