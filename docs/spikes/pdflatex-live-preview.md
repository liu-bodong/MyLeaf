# Spike: live preview with pdfLaTeX

Status: in progress. pdfTeX builds from source with pass-through stream
hooks (finding 5); the level 2 engine works and is measured (finding 6).
The owner approved level 2; level 3 is not started.
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
   A snapshot after `\begin{document}` would remove the first part; the
   second part needs level 3's page-by-page output.

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

- Building pdfTeX on macOS (the `funopen` branch is written but not
  compiled; Linux builds and runs, finding 5).
- Where pdfTeX must fork for snapshots (TeXpresso's XeTeX forks while
  reading input) and whether all state survives a fork (open `FILE*`s,
  kpathsea caches, pdfTeX's PDF object state).
- Ending a forked child mid-document cleanly (pending floats, `\end` rules).
- Images, fonts and file primitives read outside `openclose.c` (finding 5)
  must also go through the driver for rollback to be correct.

## Levels of pdfLaTeX speed

Discussed with the owner on 2026-11-14. Level 1 is done (ADR 0011). The
owner approved level 2 on 2026-11-15; level 3 is not decided.

| Level                                                                                   | Work                                  | Server time per edit (8 pages)                                        | Keystroke to screen                         |
| --------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------- |
| 1. Single pass without latexmk                                                          | Done                                  | ~280–330 ms (measured)                                                | ~300–450 ms (estimate)                      |
| 2. pdfTeX kept warm after the preamble: run to `\begin{document}`, pause, fork per edit | Engine done (finding 6); adapter next | 181–188 ms, against 222 ms for level 1 on the same machine (measured) | ~250–350 ms (estimate, not measured)        |
| 3. Full TeXpresso-style snapshots (design B above)                                      | Weeks to months                       | Comparable to TeXpresso (estimate)                                    | TeXpresso: ~130–145 ms (measured, ADR 0012) |

Level 2 is a subset of level 3 (same hooks, one snapshot, normal PDF
output), so it can be a first step towards it.

## Next step

Done: pdfTeX built with stream hooks (finding 5); the level 2 engine
(finding 6).

Next: a `LivePreviewBackend` adapter for the level 2 engine (start the
engine per preamble, run a child per edit, render the child's PDF pages to
SVG), selected by the server instead of TeXpresso by configuration, with
TeXpresso kept as the default until a replacement is accepted.
