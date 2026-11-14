# 0014. Live preview: references and citations

- Status: Accepted
- Date: 2026-11-14
- Refines: ADR 0012

## Context

Live preview (ADR 0012) typesets in a single pass, so `\ref`, `\pageref`,
the table of contents and citations showed as `??`. TeXpresso does not run
BibTeX or Biber.

## Decision

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

- References settle about half a second after typing stops; during typing
  they can show the previous pass's values.
- New or changed citations appear in live preview after the next full
  compile (the user compiles, or auto-compile runs), not while typing.
- A `.bbl` written by pdfLaTeX's BibTeX run is engine-independent; checked
  with natbib (`\citet`, `\citep`, `plainnat`).
- `readBibliography` is part of the compile port, so other compile backends
  must provide it (or return `null`).
