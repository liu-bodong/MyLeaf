# 0001. Build from scratch, reuse libraries

- Status: Accepted
- Date: 2026-11-14

## Context

The differentiating features (anchored comment threads, Google-Docs-style
suggestions, AI agents as collaborators) are defined by the document data
model. That model must be designed in from the start.

Candidates considered as a fork base:

- **Overleaf Community Edition** (AGPL-3.0, Node.js): ~10 services, requires
  MongoDB and Redis, built for SaaS operation. Its OT sync and its
  track-changes / comment storage are the parts we intend to replace, and they
  are central to the system.
- **SwiftLaTeX** (AGPL-3.0): a WASM TeX engine, not an editor platform.
- **Typst-based tools**: a different language; not usable for LaTeX.

## Decision

Start from scratch. Compose the system from existing libraries; do not fork an
editor platform.

Libraries and projects to reuse or reference (each license to be re-checked
when the dependency is added):

| Concern                      | Library / project                                             |
| ---------------------------- | ------------------------------------------------------------- |
| Source editor                | CodeMirror 6                                                  |
| PDF viewer                   | PDF.js                                                        |
| Real-time sync               | Yjs                                                           |
| LaTeX parsing                | unified-latex                                                 |
| Math rendering (visual mode) | KaTeX or MathJax                                              |
| Source ↔ PDF mapping         | SyncTeX                                                       |
| Compilation                  | TeX Live (latexmk); TeXpresso for live preview (see ADR 0006) |

## Consequences

- Full control over the data model; no inherited SaaS operations burden.
- Basic editor features that Overleaf already has must be rebuilt.
