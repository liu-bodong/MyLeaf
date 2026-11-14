import { existsSync, readdirSync, readlinkSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ProjectId } from '@myleaf/doc-model';
import type { LivePreviewEvent, LivePreviewSession } from '@myleaf/live-preview';
import { parseProjectPath } from '@myleaf/project';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sanitizeSvg } from './sanitize-svg.js';
import { TexpressoLivePreview } from './texpresso-live-preview.js';

const command =
  process.env.MYLEAF_TEXPRESSO ??
  resolve(import.meta.dirname, '../../../vendor/texpresso/build/bin/texpresso');
const available = existsSync(command);

const encoder = new TextEncoder();
const main = (firstPage: string) =>
  encoder.encode(String.raw`\documentclass{article}
\begin{document}
${firstPage}
\newpage
Second page.
\end{document}
`);

describe('sanitizeSvg', () => {
  it('removes data-text attributes, including invalid control characters', () => {
    const svg = '<use data-text="&#x0019;" href="#g1"/><use data-text="p" href="#g2"/>';
    expect(sanitizeSvg(svg)).toBe('<use href="#g1"/><use href="#g2"/>');
  });
});

// A cold start (font caches) can take several seconds on CI runners.
describe.skipIf(!available)(
  'TexpressoLivePreview (requires patched TeXpresso)',
  { timeout: 60_000 },
  () => {
    let workRoot: string;
    let session: LivePreviewSession | null = null;
    const events: LivePreviewEvent[] = [];

    /** Resolves with the first event (after `from`) matching `predicate`. */
    const waitFor = async (predicate: (e: LivePreviewEvent) => boolean, from = 0) => {
      const deadline = Date.now() + 30_000;
      for (;;) {
        const found = events.slice(from).find(predicate);
        if (found) return found;
        if (Date.now() > deadline)
          throw new Error(`no matching event in ${JSON.stringify(events)}`);
        await new Promise((r) => setTimeout(r, 20));
      }
    };
    const isPage = (page: number) => (e: LivePreviewEvent) => e.type === 'page' && e.page === page;

    /** Processes whose working directory is inside the test's work root. */
    const processesInWorkRoot = () =>
      readdirSync('/proc')
        .filter((pid) => /^\d+$/.test(pid))
        .filter((pid) => {
          try {
            return readlinkSync(`/proc/${pid}/cwd`).startsWith(workRoot);
          } catch {
            return false;
          }
        });

    beforeAll(async () => {
      workRoot = await mkdtemp(join(tmpdir(), 'myleaf-live-'));
    });

    afterEach(async () => {
      await session?.close();
      session = null;
      events.length = 0;
    });

    afterAll(async () => {
      await rm(workRoot, { recursive: true, force: true });
    });

    const open = async (firstPage = 'First page.') => {
      const backend = new TexpressoLivePreview({ command, workRoot });
      session = await backend.open(
        {
          projectId: ProjectId('live-test'),
          rootFile: parseProjectPath('main.tex'),
          files: [{ path: parseProjectPath('main.tex'), content: main(firstPage) }],
        },
        (event) => events.push(event),
      );
      return session;
    };

    it('renders the first page as valid SVG', async () => {
      await open();
      const event = await waitFor(isPage(1));
      if (event.type !== 'page') throw new Error('expected a page');
      expect(event.svg).toContain('<svg');
      expect(event.svg).not.toContain('data-text');
    });

    it('re-renders the page after an edit', async () => {
      const live = await open();
      const before = await waitFor(isPage(1));
      const from = events.length;
      live.updateFile({
        path: parseProjectPath('main.tex'),
        content: main('First page, now with \\textbf{considerably more text} than before.'),
      });
      const after = await waitFor(isPage(1), from);
      expect(after).not.toEqual(before);
    });

    it('shows other pages on request', async () => {
      const live = await open();
      await waitFor(isPage(1));
      live.showPage(2);
      await waitFor(isPage(2));
    });

    it('stops every process and removes its workspace on close', async () => {
      const live = await open();
      await waitFor(isPage(1));
      expect(processesInWorkRoot().length).toBeGreaterThan(0);
      await live.close();
      session = null;
      expect(processesInWorkRoot()).toEqual([]);
      expect(readdirSync(join(workRoot, 'live-test'))).toEqual([]);
    });
  },
);
