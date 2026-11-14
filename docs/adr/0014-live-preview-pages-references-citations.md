# 0014. Live preview: references and citations

- Status: Accepted
- Date: 2026-11-14
- Refines: ADR 0012

## Context

Live preview (ADR 0012) showed one page at a time, and typeset in a single
pass, so `\ref`, `\pageref`, the table of contents and citations showed as
`??`. TeXpresso does not run BibTeX or Biber.

## Decision

- Continuous pages: the headless export patch (`vendor/texpresso/
headless-export.patch`) now typesets the whole document (still in 5 ms
  slices between editor commands) and exports the pages of a range set with
  `["export-pages", first, last]` whenever they are (re)typeset. It finds
  re-typeset pages from the lowest page count `incdvi` was cut back to
  (rollback or reset), and announces `["page-count", n, finished]`. The
  adapter drops re-exports whose SVG is unchanged (hash per page).
- The browser lays out one slot per page in a single scroll, requests the
  visible pages plus one on each side (at most 20, `LIVE_MAX_PAGE_RANGE`),
  and keeps the largest page count seen until the final count, so the
  scroll height does not jump while a document is re-typeset.
- References: each session sends TeXpresso's `["rerun", true]` at start.
  After an edit and 500 ms without further edits, TeXpresso reruns the
  engine with the previous pass's `.aux` until it no longer changes (at most
  5 passes; upstream defaults).
- Citations: live preview uses the bibliography of the latest full compile.
  `CompileBackend.readBibliography` returns `<job>.bbl` from the build output
  with the project path where TeX reads it (the project root). The server
  adds it to a new session's files, replacing a stored file of that name, and
  sends it to the project's open sessions after every compile.

## Consequences

- TeXpresso now re-typesets up to the end of the document after each edit,
  not only up to the viewed page: more CPU while editing long documents; the
  visible pages are not delayed, since typesetting is sequential either way.
- Pages arrive per page; a page outside the requested range keeps its last
  rendering until it is scrolled to.
- References settle about half a second after typing stops; during typing
  they can show the previous pass's values.
- New or changed citations appear in live preview after the next full
  compile (the user compiles, or auto-compile runs), not while typing.
- A `.bbl` written by pdfLaTeX's BibTeX run is engine-independent; checked
  with natbib (`\citet`, `\citep`, `plainnat`).
- `readBibliography` is part of the compile port, so other compile backends
  must provide it (or return `null`).
