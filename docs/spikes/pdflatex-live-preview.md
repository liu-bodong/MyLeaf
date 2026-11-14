# Spike: live preview with pdfLaTeX

Status: paused (analysis done; pdfTeX build and hook prototype not started).
The owner decides whether to continue.
Date: 2026-11-14. Roadmap item: "Live preview with pdfLaTeX".

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

- Building pdfTeX from TeX Live sources with the hooks, on Linux and macOS.
- Where pdfTeX must fork for snapshots (TeXpresso's XeTeX forks while
  reading input) and whether all state survives a fork (open `FILE*`s,
  kpathsea caches, pdfTeX's PDF object state).
- Ending a forked child mid-document cleanly (pending floats, `\end` rules).
- Images and fonts read outside `openclose.c` must also go through the
  driver for rollback to be correct.

## Next step

Build pdfTeX from TeX Live sources in the container, add the stream
hooks in `openclose.c`, and check that a document compiles through them.
