# 0012. Live preview with a patched TeXpresso

- Status: Accepted (integration design: Proposed)
- Date: 2026-11-14
- Refines: ADR 0006 (L3)

## Context

ADR 0011 made full compiles fast (~0.4–0.7 s server time). The goal of L3 is
Typst-like live rendering. TeXpresso (MIT) does this for LaTeX; a prototype
evaluated it on the 8-page benchmark paper
(`packages/compile-texlive/bench/paper.tex`), headless in Linux.

### How TeXpresso works (verified in source, upstream commit `e8df770`)

- A modified XeTeX engine performs all file I/O through a driver.
- The driver snapshots the engine with `fork()` about every 500 ms of engine
  time (`need_snapshot`, `engine_tex.c`). On an edit it resumes from the latest
  snapshot before the first changed byte (`rollback_processes`).
- It typesets only up to the page being viewed (`need_advance`, `main.c`).
- Output is XDV, rendered page by page; cross-references converge in a later
  rerun pass (`engine_finish_convergence`), off by default.

### Measurements (TeX Live 2023, 8-page paper)

| Measurement                                     | Result          |
| ----------------------------------------------- | --------------- |
| First page, cold (includes the preamble)        | 0.69–0.81 s     |
| Pages 2–8                                       | +0.26 s         |
| Edit → viewed page re-typeset (median)          | 44–73 ms        |
| Edit → page written as SVG (median)             | 48–76 ms        |
| SVG export time / size (gzipped)                | 0–3 ms / ~32 KB |
| PNG export time (2x)                            | 25–45 ms        |
| Memory per live document (PSS, 22–23 processes) | ~250 MB         |

The first edit in a newly viewed region can take longer (360–870 ms) because
the nearest snapshot is further back.

### Problems found

- No headless mode: it always opens an SDL window (`SDL_VIDEODRIVER=dummy`
  works around it) and pages only reach that window.
- The JSON `change` command loses its file path (strings are read from a
  reused parser buffer). Re-sending the full text with `open` works: the
  driver diffs it and rolls back from the first changed byte.
- In `-lines` mode, the log line holding the newest page marker is withheld
  until complete; byte mode streams it.
- MuPDF's SVG output contains `data-text` attributes with control characters
  (invalid XML); they must be stripped.
- XeTeX only: output can differ from pdfLaTeX.

## Decision

1. Live preview is a second view next to the normal compile. The pdfLaTeX
   compile (ADRs 0010, 0011) stays authoritative for the final PDF.
2. Use TeXpresso, built by `vendor/texpresso/build.sh` from a pinned upstream
   commit with patches in `vendor/texpresso/*.patch`. Move to a fork as a git
   submodule if the patches grow.
3. `headless-export.patch` writes each displayed page as SVG (vector, ~2 ms)
   and announces it on stdout as `["page-exported", page, path, ms]`.

## Integration design (Proposed)

- A `LivePreview` port in a domain package, with a TeXpresso adapter that runs
  one TeXpresso process per open project (sessions capped and closed when
  idle, given ~250 MB each).
- A WebSocket per open project: the browser sends edits and the viewed page;
  the server pushes page SVGs (with `data-text` stripped). Edits go to the
  live session immediately, independent of the debounced save.
- The web app shows live pages in place of the PDF while live preview is on.
- CI builds TeXpresso and runs an integration test.

## Consequences

- Sub-100 ms feedback for edits on the viewed page, on Linux and macOS hosts.
- Hosts need the TeXpresso build dependencies and XeTeX.
- Same trust model as compilation (ADR 0010): TeXpresso's file access is not
  sandboxed.
