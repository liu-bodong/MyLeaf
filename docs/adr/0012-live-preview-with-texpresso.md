# 0012. Live preview with a patched TeXpresso

- Status: Accepted
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

## Integration

- Port `LivePreviewBackend` (`@myleaf/live-preview`); adapter
  `TexpressoLivePreview` (`@myleaf/live-texpresso`) runs one TeXpresso process
  group per session, sends file changes with `open-base64` (full content) and
  the visible page range with `export-pages` (ADR 0014; at first, single
  pages with `next-page` / `previous-page`), and emits sanitized SVG pages. Closing a session waits for the whole process group to exit.
- The server (`/api/projects/:id/live`, WebSocket) opens a session per
  connection from the stored files. The browser sends the open document's
  text on every change, independent of the debounced save; saved files and
  uploads are forwarded to open sessions too.
- `LiveSessionPool` limits sessions (`MYLEAF_LIVE_MAX_SESSIONS`, default 4)
  and closes idle ones (`MYLEAF_LIVE_IDLE_MINUTES`, default 10). These and
  `MYLEAF_TEXPRESSO` (below) are environment variables for now;
  engine choice, compile settings and resource limits are to become
  configurable in the UI later.
- The web app shows live pages when the project setting `livePreview` is on
  (Compile menu, off by default). A PDF/Live switch keeps the PDF reachable;
  when a session ends, the pane offers Retry and Show PDF.
- The server uses the binary `MYLEAF_TEXPRESSO` names, or else the build of
  `vendor/texpresso/build.sh` if present; `MYLEAF_TEXPRESSO=off` disables
  live preview. It checks at startup that the binary is executable and
  otherwise reports live preview as unavailable.
- Process cleanup: the server closes all sessions on SIGINT/SIGTERM. If it
  dies without closing them (crash, SIGKILL), each session's process group
  stops itself: TeXpresso runs under a small POSIX `sh` supervisor whose
  watcher polls the server's PID once a second and then sends SIGTERM, and
  SIGKILL 2 s later, to the group. This works on Linux and macOS alike.
  (TeXpresso itself keeps running when its stdin closes while idle, and
  `setpriv --pdeathsig`, used before, exists only on Linux.) Session
  workspaces left behind are removed when the server starts.
- CI builds TeXpresso; adapter and end-to-end tests cover it.

Measured in Chromium against the dev server (benchmark paper, page 1):
keystroke to updated page on screen about 130–145 ms; the first edit after
the session starts about 0.9 s.

## Consequences

- Sub-100 ms feedback for edits on the viewed page, on Linux and macOS hosts.
- Hosts need the TeXpresso build dependencies and XeTeX.
- Same trust model as compilation (ADR 0010): TeXpresso's file access is not
  sandboxed.
