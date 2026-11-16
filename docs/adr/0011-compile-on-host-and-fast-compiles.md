# 0011. Compile on the host; fast compiles (L1)

- Status: Accepted
- Date: 2026-11-14
- Refines: ADR 0006

## Context

The goal is near-instant feedback, eventually Typst-like live rendering
(ADR 0006, L3). Before optimising, two alternatives were examined.

**Compiling in the browser (WebAssembly).** TeX Live 2026 builds for the
browser exist (BusyTeX, texlyre-busytex, Siglum). texlyre-busytex 1.4.1 ships
a 31 MB engine plus TeX Live data in tiers of 88.5 MB (basic), 192 MB
(recommended) and 326 MB (extra); an ordinary paper using `enumitem` and
`cleveref` needs the extra tier. Hands-on use of TeXlyre (which uses this
engine) showed compiles much slower than native and no live rendering.
TeXpresso-style live rendering depends on `fork()`, which browsers lack.

**TeXlyre** (an AGPL editor with Yjs collaboration and browser compiles) was
evaluated as a base and rejected for the same reasons.

**Where compile time went** (8-page benchmark paper, TeX Live 2023, native):
starting pdfTeX ~105 ms, loading the preamble ~500 ms, typesetting the body
~55 ms, a second latexmk pass when headings or labels change, and ~650 ms in
the browser to render all pages before showing any.

## Decision

1. **Compilation runs on the host** (server or, later, desktop). Browser
   compilation is not pursued now; the `CompileBackend` port leaves room for it.
2. **Precompiled preamble** (pdfLaTeX only), in the TeX Live adapter:
   - The root file's text before `\begin{document}` is dumped into a TeX
     format with `mylatexformat`, in the background after the compile that
     first sees it (queued before the next compile of the project).
   - Later compiles load the format via `TEXFORMATS` and `-fmt` (an absolute
     `-fmt` path breaks pdfTeX's `-recorder` with `-output-directory`).
   - The format is keyed by TeX version, root file path and preamble text,
     and records the project files it read (from the `.fls` recorder file,
     excluding the root file). Any change rebuilds it.
   - If building fails, the preamble is marked as not precompilable. If a
     compile with the format fails without a PDF and without errors in
     project files, it is retried without the format, and the format is
     marked failed if that helps.
   - XeLaTeX and LuaLaTeX compile normally (`mylatexformat` does not support
     LuaLaTeX; XeLaTeX formats cannot hold loaded fonts).
3. **PDF viewer**: one shared PDF.js worker; only pages near the visible area
   are rendered; each page keeps its previous version until the new one is
   drawn.
4. **Per-project settings** (first "configurable knobs"): `autoCompile`
   (default off; compiles after a 1 s pause in typing, at most one compile
   running and one queued) and `precompilePreamble` (default on).
5. A benchmark (`pnpm bench`, `packages/compile-texlive/bench/`) tracks
   compile times.
6. **Single pass while editing** (added later): auto-compile asks for
   `CompileOptions.singlePass`. The TeX Live adapter then runs pdfLaTeX once
   (precompiled preamble, `-recorder`), without latexmk (about 100 ms of its
   own) and without reruns: references, citations and the table of contents
   come from the previous compile's `.aux`, as in live preview. Recompile
   (button, Ctrl-S) stays a full latexmk compile. The adapter compiles fully
   anyway when there is no previous compile of the same root file, when no
   file changed (latexmk then does nothing), and for XeLaTeX and LuaLaTeX.

Rejected: a pre-started pdfTeX process (no gain: pdfTeX loads the format only
after reading the file name); `\includeonly` for the edited chapter (changes
the output).

7. **Image options** (added later), per project, for compiles and live
   preview:
   - `reuseImages` (default on, pdfLaTeX): pdfTeX decodes PNGs with
     transparency (an alpha channel or `tRNS`, as matplotlib writes them)
     or interlacing, and compresses them again, on every compile. The TeX
     Live adapter converts each such image once, in the background after
     the compile that first sees it, into a one-page PDF made by pdfTeX
     itself, and later compiles use that copy under the image's own name
     (pdfTeX recognises image types by their first bytes). pdfTeX copies
     the PDF's streams as they are; pages look the same pixel for pixel.
     Copies are keyed by content and TeX version and shared by projects
     (`<builds>/.images`, least recently used beyond 500 MB removed).
     A document that sets `\pdfimageresolution` or applies gamma would see
     its PNGs at the defaults instead; such documents can turn it off.
   - `draftImages` (default off): `\csname Gin@drafttrue\endcsname` is
     inserted right after `\begin{document}` on the same line of the
     compiled copy of the root file, so graphicx draws boxes with file
     names. Line numbers and the preamble (and so the precompiled
     preamble) do not change. The command line (`-pretex`) cannot be used:
     `mylatexformat` skips it.
   - Live preview applies both to the files it typesets (converted images
     only with the pdfTeX engine); changing either starts a new session.

## Results

Server compile, median of 5 (`pnpm bench`, TeX Live 2023):

| Scenario     | Before   | After  |
| ------------ | -------- | ------ |
| Text edit    | 849 ms   | 424 ms |
| Heading edit | 1,657 ms | 737 ms |

Click on Compile to updated page on screen, text edit, measured in Chromium
against the dev server: about 1.5–1.9 s before, about 0.6 s after.

Single pass while editing (same benchmark, later run): text edit 404 →
about 280–330 ms, heading edit 697 → about 290–310 ms. Its `No change` row
is not comparable: after single-pass edits, the next full compile catches up
on the reruns they skipped.

Where a single-pass edit's time goes (same paper, later measurement):

| Run                                    | Time        |
| -------------------------------------- | ----------- |
| latexmk with the precompiled preamble  | ~380 ms     |
| pdfLaTeX directly, same preamble       | ~255–320 ms |
| pdfLaTeX, same preamble, one-line body | ~190 ms     |
| Plain `article`, one line, no packages | ~125 ms     |

About 190 ms is fixed per run (start-up, loading the format, package setup
at `\begin{document}`, fonts, writing the PDF); typesetting the 8 pages
takes about 70–80 ms. Only engine work (a pdfTeX kept warm after the
preamble; `docs/spikes/pdflatex-live-preview.md`) removes the fixed part,
so compiles stay at about 300 ms; live preview is about 130–145 ms from
keystroke to screen (ADR 0012).

Deferred: stopping pdfLaTeX after the viewed page. It saved little on the
8-page paper (about 200 ms stopping after page 1, about 270 ms for all 8)
and writes a truncated PDF, which the viewer would have to merge with the
last full PDF. It may pay off on long documents when editing early pages.

## Consequences

- About 7.5 MB of disk per project for the format (for this preamble).
- The first compile after a preamble change is not faster.
- Live rendering (L3, TeXpresso approach) remains the next step for
  sub-second feedback; showing the PDF after the first pass needs the push
  channel planned for phase 2.

Image options (`pnpm bench:images`: five figures, three of them 2400 x 1800
transparent PNGs; precompiled preamble, median of 5, TeX Live 2023):

| Text edit                  | No option | Reuse images | Draft images |
| -------------------------- | --------: | -----------: | -----------: |
| Recompile                  |  1,173 ms |       350 ms |       361 ms |
| Auto-compile (single pass) |  1,023 ms |       216 ms |       212 ms |

pdfTeX live preview on the same paper, time to re-typeset the whole
document after an edit (median of 7): 1,411 ms, 128 ms reusing images,
86 ms with draft images.
