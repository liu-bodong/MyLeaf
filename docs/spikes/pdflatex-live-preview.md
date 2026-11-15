# Spike: live preview with pdfLaTeX

Status: level 2 done; level 3 in progress (owner approved on 2026-11-15).
pdfTeX builds from source with pass-through stream hooks (finding 5); the
level 2 engine (finding 6) runs live preview with
`MYLEAF_LIVE_ENGINE=pdftex`. Level 3 steps 1 and 2, page-by-page output
(finding 8) and snapshots inside the document (finding 9), are done; step 3
is measuring keystroke to screen against TeXpresso.
Date: 2026-11-14, updated 2026-11-15. Roadmap item: "Live preview with pdfLaTeX".

Question: can TeXpresso's technique (ADR 0012) run on pdfTeX, so live
preview matches the final pdfLaTeX PDF?

## Findings

Measurements: benchmark paper `packages/compile-texlive/bench/paper.tex`
(8 pages, microtype), TeX Live 2023 in the cloud container. "Differing line
ends" compares the last word of each text line (417 lines) between two PDFs;
about 16 differences are math-extraction noise, not layout.

1. **TeXpresso's engine protocol is engine-independent.** The engine talks
   to the driver through a small API (`src/engine/main/texpresso_protocol.h`):
   open, read, append, close, size, mtime, `seen` (input consumed), `fork`
   (snapshot) and an image-bounds cache. The driver has an engine interface
   (`txp_engine_class`: step, render page, page count, change handling); the
   XeTeX engine is one implementation (`engine_tex.c`, 1,645 lines), a plain
   PDF viewer another (`engine_pdf.c`).
2. **pdfTeX's file access is concentrated.** TeX Live's pdfTeX (40,338-line
   `pdftex.web` plus change files) opens input and output in
   `texk/web2c/lib/openclose.c` and `texmfmp.c` (`FILE*`, kpathsea). PDF-mode
   font and image readers (`writet1.c`, `mapfile.c`, `writeimg.c`, ...)
   open files on their own. Candidate approach: return TeXpresso-backed
   `FILE*` streams (`fopencookie` on Linux, `funopen` on macOS) at those
   points, leaving the engine source untouched. Not yet built or tested.
3. **DVI mode does not give pdfLaTeX's layout.** pdfTeX in DVI mode (with
   dvipdfmx drivers for graphicx, xcolor, hyperref) would reuse TeXpresso's
   renderer, which already reads TFM, virtual fonts, font maps and encodings.
   But microtype's font expansion is off in DVI mode:
   - DVI mode vs final PDF: 90 of 417 line ends differ.
   - PDF mode with `expansion=false` vs DVI mode: 16 (noise only).
   - XeLaTeX (today's live preview) vs final PDF: 106.
     So DVI mode is barely closer to the final PDF than XeLaTeX on a paper
     using microtype.
4. **PDF mode is affordable.** Finishing a PDF (fonts, xref) after the last
   page took 22–25 ms. Design B: when the viewed page is shipped out, a
   forked copy of pdfTeX finishes the PDF up to that page; the driver
   renders that page with MuPDF (already a dependency). Output is real
   pdfTeX output, including font expansion and images.

5. **pdfTeX builds from source with stream hooks, and output is unchanged.**
   `vendor/pdftex/build.sh` builds pdfTeX 1.40.25 from TeX Live's
   `texlive-2023.0` tag (the release Ubuntu 24.04 ships) in about 4 minutes
   on 4 cores. `stream-hooks.patch` (173 added lines in `openclose.c`,
   `lib.h` and `texmfmp.h`) returns every file opened by `open_input` and
   `open_output` as a `fopencookie` stream that passes through to the real
   file, when `MYLEAF_PDFTEX_HOOKS` is set. `vendor/pdftex/check-hooks.sh`
   compiled the benchmark paper (8 pages) and a document with PNG, JPEG and
   PDF images (`vendor/pdftex/fixtures/images.tex`), hooks off and on:
   - The PDFs are byte-identical (`SOURCE_DATE_EPOCH=0`, `FORCE_SOURCE_DATE=1`).
   - The paper made 172 opens through the hooks: the main file, classes,
     packages, `.aux`/`.out`/`.log`/`.pdf`, TFM and virtual fonts, font maps
     and encodings.
   - Overhead: none measurable. `pnpm bench:pdftex-hooks` (full compile of
     the paper with a plain `pdflatex` format, median of 21, cloud container)
     gave off/on 536/555, 523/525 and 549/550 ms in three runs; run-to-run
     noise is about ±15 ms.
   - Format files cannot be hooked as they are: zlib reads and writes them
     through the file descriptor (`gzdopen(fileno(f))`). They are read once
     at start-up, so this does not matter for snapshots.

   Opened outside the hooks (traced with `strace`):

   | What                                           | Where in pdfTeX                                                   | Matters for live preview                             |
   | ---------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------- |
   | Type 1 fonts (`.pfb`), when written to the PDF | `writet1.c` (`xfopen` of the path found by `mapfile.c`)           | No for TeX Live fonts; yes for project fonts         |
   | Images (PNG, JPEG, PDF), each opened twice     | `writepng.c`, `writejpg.c`, `writeimg.c` (xpdf)                   | Yes: project images change                           |
   | `\pdfmdfivesum file`, `\pdffiledump`           | `texmfmp.c` (`getmd5sum`, `getfiledump`)                          | Yes: `rerunfilecheck` (hyperref) hashes `main.out`   |
   | `\pdffilesize`, `\pdffilemoddate`              | `texmfmp.c` (`stat`)                                              | Yes: maps to TeXpresso's `size` and `mtime` requests |
   | First line of the main file (`%&` format line) | `texmfmp.c` (`parse_first_line`); off with `-no-parse-first-line` | No                                                   |
   | `texmf.cnf`, `ls-R`, `texfonts.map`            | kpathsea                                                          | No: TeX Live configuration                           |

   PK and JBIG2 fonts/images (`writet3.c`, `writejbig2.c`) also use `xfopen`
   but did not occur in these documents.

6. **Level 2 engine: pause before `\begin{document}`, fork per edit.**
   `vendor/pdftex/warm-fork.patch` (on top of the stream hooks, all in
   `openclose.c`) stops pdfTeX when the main file's stream is about to read
   the `\begin{document}` line, and forks a child per edit that reads the
   rest of the main file from the new content and writes to its own
   directory (protocol in `vendor/pdftex/README.md`). No pdfTeX source
   (`pdftex.web`) changes were needed: TeX only reads the next line when it
   needs it, so stopping the stream at a line start pauses TeX between
   lines.
   - The child's PDF is identical to a full run of the same source and
     `.aux`, apart from the `/ID` (a hash that includes the output path).
   - Files the child reads after the pause come from disk, so the reads
     outside the hooks (finding 5) do not affect level 2: the driver writes
     changed project files before forking. Only files read before the pause
     matter; the engine reports them (`input`), and a change to one of them
     (or to the preamble) needs a new engine.

   Measured with `pnpm bench:pdftex-warm` (cloud container, median of 11)
   and `pnpm bench` (single pass) on the same machine:

   | Run (benchmark paper, text edit)                       | Time                  |
   | ------------------------------------------------------ | --------------------- |
   | Full run (plain `pdflatex` format)                     | 536–571 ms            |
   | Level 1: single pass with the precompiled preamble     | 222 ms (`pnpm bench`) |
   | Level 2: forked child, edit to PDF                     | 181–188 ms            |
   | Level 2: forked child, one-line body                   | 115–118 ms            |
   | Level 2: engine start to the pause (once per preamble) | ~350–400 ms           |

   Level 2 saves about 35–40 ms per edit over level 1 on this paper, less
   than estimated. What is left in the child is fixed work after the pause:
   `\begin{document}` (about 42 ms, measured with `\pdfelapsedtime`;
   hyperref, microtype and other `AtBeginDocument` code) and finishing the
   document (about 70 ms: `\end{document}` code, embedding font subsets,
   writing the PDF, process exit). Typesetting the 8 pages is about 65 ms.
   Finding 7 removes most of this without a new snapshot mechanism.

7. **Pausing after the `\begin{document}` line.** The same patch pauses at
   any line start, so the engine can also run `\begin{document}` before it
   pauses (the offset is the start of the line after it). The child then
   only typesets the body and finishes the document.
   - The PDF is identical to a full run with the same `.aux`, apart from
     `/ID` and the dates.
   - The `.aux` (and other files read at `\begin{document}`, such as
     hyperref's `.out`) are read once per engine. The adapter starts a new
     engine in the background when a run writes a different `.aux`, and
     runs once more on it (below).
   - The engine has its own `-output-directory`: at `\begin{document}` it
     opens the `.aux` for writing, which would otherwise truncate the one
     the next engine reads.
   - Text typed on the `\begin{document}` line itself is then part of the
     preamble and starts a new engine (about 480 ms).

   Measured with `pnpm bench:pdftex-warm` (cloud container, median of 11,
   same run for all rows):

   | Run (benchmark paper)                                   | Time   |
   | ------------------------------------------------------- | ------ |
   | Full run, text edit                                     | 546 ms |
   | Pause before the `\begin{document}` line, text edit     | 185 ms |
   | Pause before the `\begin{document}` line, one-line body | 114 ms |
   | Pause after the `\begin{document}` line, text edit      | 80 ms  |
   | Pause after the `\begin{document}` line, one-line body  | 11 ms  |
   | Engine start to the pause before the line               | 352 ms |
   | Engine start to the pause after the line                | 476 ms |

   Instrumented with `\pdfelapsedtime`, the 80 ms are about 66 ms of
   typesetting the 8 pages and 9 ms after `\end{document}`; the rest is
   fork and messages. The ~70 ms after the body in finding 6 is down to
   about 9 ms, while the engine start grew by about 124 ms, more than the
   ~42 ms of `\begin{document}`. So other work that the child used to do
   now happens once in the engine; which work that is was not
   investigated.

8. **Page-by-page output (level 3, step 1).** `warm-fork.patch` also hooks
   pdfTeX's `ship_out` (`pdftex.web`: one call after `pdf_ship_out`; the C
   side is in `pdftexdir/utils.c` and `lib/openclose.c`). A `run` can name
   a page range. When the child ships out a page in it, it forks a
   finisher: a copy that moves its open output files to
   `<output-dir>/page-<n>/`, runs pdfTeX's end of job
   (`close_files_and_terminate`: font subsets used so far, cross-reference
   table), says `page` and exits. The child continues.
   - Page k of a finisher's PDF renders identically (`mutool draw` to PNG)
     to page k of the child's whole PDF (benchmark paper, pages 1 to 3).
     The finisher's PDF has pages 1 to k only.
   - Finishers run beside the child, so a `page` line can come after the
     run's `done`, and out of order.
   - Children keep the control descriptor for `page` (in level 2 they
     closed it); only the engine sends `input` lines, so files that
     children read do not count as preamble dependencies.
   - Each finisher costs a fork and a copy of the PDF so far. With a
     finisher for each of the 7 pages of the ICML sample
     (`samples/icml2027`), the child took 155–208 ms instead of 136–147 ms
     (6 runs each, 4 cores). The adapter asks only for the visible pages.

   Measured with `pnpm bench:pdftex-warm` (cloud container, median of 11,
   text edit, pause after the `\begin{document}` line):

   | Page shown (benchmark paper) | To its `page` message | To `done` |
   | ---------------------------- | --------------------- | --------- |
   | 1                            | 34 ms                 | 88 ms     |
   | 3                            | 55 ms                 | 90 ms     |
   | 8 (last)                     | 97 ms                 | 96 ms     |

   The last page gains nothing: the child still typesets the body from its
   start. Snapshots inside the document (finding 9) are for that.

9. **Snapshots inside the document (level 3, step 2).** With
   `MYLEAF_PDFTEX_SNAPSHOTS`, the first time a run's child reads the main
   file after a shipout, it forks: the new process goes on, and the old one
   stays paused as a snapshot of TeX's state after `<pos>` bytes of the main
   file (protocol in `vendor/pdftex/README.md`). A later run whose first
   `<pos>` bytes are the same, with other files unchanged, resumes there:
   pages before it are not typeset again.
   - The state is taken while the main file's stdio buffer is empty, so TeX
     has consumed exactly `<pos>` bytes; the main file is read in blocks of
     512 bytes so that this happens soon after each shipout.
   - Paused processes form a chain (the engine, snapshots, the running
     child), as in TeXpresso: one reads commands only once its child
     exited. Going back to snapshot _k_ means killing the processes after
     it; a process whose parent died exits (`PR_SET_PDEATHSIG` on Linux, a
     parent check elsewhere).
   - Output files are shared with the snapshot's descendants, which keep
     writing them. A run from a snapshot copies each output's first bytes up
     to the size the snapshot had written, from the open descriptor (outputs
     are opened for reading too), and seeks to its position: pdfTeX seeks
     back in the PDF to fill in stream lengths, so bytes written are not the
     size. A first version that copied bytes written gave broken PDFs.
   - Benchmark paper, 6 runs with an edit in the last section (4 runs) or
     the first paragraph (2), each run's PDF checked page by page
     (`mutool draw`) against a full run of the same source and `.aux`: all
     identical, including the 2 runs that resumed from a snapshot after
     page 6.
   - Cost: the engine's resident memory is about 39 MB; a snapshot fork and
     the copy-on-write faults after it cost the child about 4–5 ms each, so
     a run from the engine that takes 7 snapshots finishes about 30 ms
     later (below). Each snapshot is a process; nothing limits their number
     yet (one per page).

   Measured with `pnpm bench:pdftex-warm` (cloud container, median of 11,
   pause after the `\begin{document}` line, page 8 of 8 shown, including
   killing snapshots and waiting for `resumed`):

   | Run (benchmark paper)                        | To page 8 | To `done` |
   | -------------------------------------------- | --------- | --------- |
   | No snapshots, text edit (finding 8)          | 87–97 ms  | 91–96 ms  |
   | Edit in the first paragraph, from the engine | 114 ms    | 125 ms    |
   | Edit in the last paragraph, from a snapshot  | 32 ms     | 34 ms     |

## Proposed design (B)

- Engine: TeX Live pdfTeX built with TeXpresso's I/O and snapshot hooks
  (`texpresso-pdftex`), PDF mode.
- At each shipout of a requested page: fork; the child closes the document
  (PDF up to that page) and exits; the parent continues.
- Driver: a `pdftex` engine class reusing `engine_tex.c`'s process,
  snapshot, rollback and file tracking, with page display from the
  finished PDFs instead of incremental DVI.
- MyLeaf side unchanged: same `LivePreviewBackend` port, messages and UI.

## Open risks

- pdfTeX on macOS: it builds with `vendor/pdftex/macos-target-os-mac.patch`
  and the stream hooks (`funopen`) gave identical PDFs on the owner's Mac
  with MacTeX 2025; the warm fork has not been run there yet. MacTeX is
  TeX Live 2025, newer than the pinned pdfTeX 1.40.25 (TeX Live 2023).
- Where pdfTeX must fork for snapshots (TeXpresso's XeTeX forks while
  reading input) and whether all state survives a fork (open `FILE*`s,
  kpathsea caches, pdfTeX's PDF object state).
- Ending a forked child mid-document cleanly (pending floats, `\end` rules).
  Finishers (finding 8) end at a shipout with pdfTeX's end of job, not
  LaTeX's `\end{document}`; pages compared so far were identical.
- Snapshots (finding 9): input files other than the main file that are open
  at a snapshot (an `\openin` kept open across pages) share their offset
  with the snapshot's descendants, which would make a resumed run read
  from the wrong place. Not handled; snapshots are only valid when other
  files are unchanged, but this case is not detected.
- Number of snapshot processes for long documents (one per page, not
  limited yet).
- Images, fonts and file primitives read outside `openclose.c` (finding 5)
  must also go through the driver for rollback to be correct.

## Levels of pdfLaTeX speed

Discussed with the owner on 2026-11-14. Level 1 is done (ADR 0011). The
owner approved level 2 on 2026-11-15, and level 3 later that day.

| Level                                                                                   | Work                                            | Server time per edit (8 pages)                                                                 | Keystroke to screen                         |
| --------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1. Single pass without latexmk                                                          | Done                                            | ~280–330 ms (measured)                                                                         | ~300–450 ms (estimate)                      |
| 2. pdfTeX kept warm after the preamble: run to `\begin{document}`, pause, fork per edit | Done (findings 6 and 7, `packages/live-pdftex`) | 80 ms child, ~97 ms to the SVG page, against 222 ms for level 1 on the same machine (measured) | 123–269 ms, medians 177–193 ms (measured)   |
| 3. Full TeXpresso-style snapshots (design B above)                                      | Steps 1 and 2 done (findings 8 and 9)           | Comparable to TeXpresso (estimate)                                                             | TeXpresso: ~130–145 ms (measured, ADR 0012) |

Level 2 is a subset of level 3 (same hooks, one snapshot, normal PDF
output), so it can be a first step towards it.

## Live preview on the level 2 and 3 engine

`packages/live-pdftex` (`PdftexLivePreview`) implements the
`LivePreviewBackend` port; the server uses it with
`MYLEAF_LIVE_ENGINE=pdftex` (default: TeXpresso). Server routes, WebSocket
messages and UI are unchanged.

- Per session: an engine for the root file's preamble, paused after the
  `\begin{document}` line (finding 7). Each edit runs one
  child (one at a time; edits during a run are coalesced into one more run).
  A new engine starts when the preamble or a project file read before the
  pause changes. Without `\begin{document}` in the root file, each run is a
  full pdfTeX run.
- Pages: the child's PDF pages in the requested range are rendered to SVG
  with `mutool draw` (about 10 ms per page) and emitted when they changed.
  MuPDF names glyph outlines after their index in pdfTeX's font subset,
  which changes when other pages use new glyphs; the adapter renumbers them
  in order of use, so unchanged pages are not re-sent.
- Page by page (finding 8): each `run` names the visible range. On a
  `page` line the adapter renders that page from the finisher's PDF and
  emits it, with a non-final `page-count`; a page from an older run never
  replaces a newer run's. When an edit arrives during a run whose last
  visible page is already shown, the adapter cancels the rest of that run
  (it kills the run's child); references and the final page count then
  come from the next run that completes.
- Snapshots (finding 9): the adapter keeps each engine's snapshots in
  chain order with the root-file bytes they read. A run resumes from the
  last one whose bytes match the new root file, if no other project file
  changed since its run started; otherwise from the engine.
- References: the engine reads the `.aux` at `\begin{document}`. When a run
  writes a different `.aux`, a new engine that reads it starts in the
  background, replaces the current one when ready, and the adapter runs
  once more without an edit, so references settle as with latexmk's reruns
  (at most 3 such runs in a row). Citations come from the `.bbl` the server
  adds (ADR 0014).
- Keystroke to updated page on screen, measured in Chromium against the dev
  server (benchmark paper, typing in the first paragraph, page 1, 12 edits
  per run, 3 runs): medians 177, 193 and 181 ms (123–269 ms). Pausing
  before the `\begin{document}` line, measured the same way: medians 268
  and 292 ms (232–380 ms). For comparison, ADR 0012 measured 130–145 ms for
  TeXpresso on another machine; not measured side by side here.
- Where the ~180 ms go (same machine, medians): edit to `page` event in the
  adapter ~97 ms (child 80 ms, `mutool` ~10 ms per page); edit to `page`
  message over the WebSocket ~124 ms (the SVG is ~290–330 KB); the browser
  (parsing the message, the image, the editor's own work per keystroke) the
  remaining ~55–65 ms.
- Edit to `page` event in the adapter, level 2 against page by page
  (cloud container, one session per row, median of 12 edits 1.5 s apart,
  each edit next to the page viewed):

  | Document, page viewed        | Level 2 | Page by page |
  | ---------------------------- | ------- | ------------ |
  | Benchmark paper (8 pages), 1 | 107 ms  | 54 ms        |
  | Benchmark paper, 3           | 117 ms  | 75 ms        |
  | ICML sample (7 pages), 1     | 178 ms  | 84 ms        |
  | ICML sample, 3               | 178 ms  | 124 ms       |

  Typing 25 keys 80 ms apart with page 1 viewed: level 2 emitted 20
  (paper) and 11 (ICML) page updates during the typing, the last one 103
  and 250 ms after the last key; page by page, 25 and 24 updates, the last
  46 and 100 ms after the last key. Keystroke to screen in the browser was
  not measured again yet.

- With snapshots as well, measured the same way (edits next to the page
  viewed):

  | Document, page viewed | Level 2 | Page by page | With snapshots |
  | --------------------- | ------- | ------------ | -------------- |
  | Benchmark paper, 1    | 107 ms  | 54 ms        | 55 ms          |
  | Benchmark paper, 3    | 117 ms  | 75 ms        | 47 ms          |
  | Benchmark paper, 8    | 108 ms  | —            | 50 ms          |
  | ICML sample, 1        | 178 ms  | 84 ms        | 85–101 ms      |
  | ICML sample, 3        | 178 ms  | 124 ms       | 66 ms          |
  | ICML sample, 7        | 181 ms  | —            | 70 ms          |

  (ICML page 1: two sessions, medians 101 and 85 ms.) Typing on page 1 as
  above: 25 (paper) and 22 (ICML) updates, the last 56 and 126 ms after the
  last key.

## Next step

Done: pdfTeX built with stream hooks (finding 5); the level 2 engine
(findings 6 and 7); the live-preview adapter; level 3 steps 1 and 2,
page-by-page output (finding 8) and snapshots (finding 9).

Level 3 step 3: keystroke to screen in the browser, side by side with
TeXpresso where it runs; then the open risks of finding 9 (a limit on
snapshot processes).
