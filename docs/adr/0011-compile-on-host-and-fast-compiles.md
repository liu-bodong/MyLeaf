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

Rejected: a pre-started pdfTeX process (no gain: pdfTeX loads the format only
after reading the file name); `\includeonly` for the edited chapter (changes
the output).

## Results

Server compile, median of 5 (`pnpm bench`, TeX Live 2023):

| Scenario     | Before   | After  |
| ------------ | -------- | ------ |
| Text edit    | 849 ms   | 424 ms |
| Heading edit | 1,657 ms | 737 ms |

Click on Compile to updated page on screen, text edit, measured in Chromium
against the dev server: about 1.5–1.9 s before, about 0.6 s after.

## Consequences

- About 7.5 MB of disk per project for the format (for this preamble).
- The first compile after a preamble change is not faster.
- Live rendering (L3, TeXpresso approach) remains the next step for
  sub-second feedback; showing the PDF after the first pass needs the push
  channel planned for phase 2.
