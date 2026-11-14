# 0006. Compilation architecture

- Status: Accepted
- Date: 2026-11-14

## Context

Goal: near-instant feedback, comparable to Typst's incremental compilation.
Primary engine in use: **pdfLaTeX**.

TeX is not designed for incremental compilation: macro state is global and
output depends on the whole document. We will not write a TeX engine; that
would be a multi-year effort and would break package compatibility.

### TeXpresso (github.com/let-def/texpresso, MIT)

Verified from its repository:

- Engine: a modified **XeTeX** (`texpresso-xetex`). It does not run pdfTeX.
- Incrementality: the driver tracks which bytes of each input file the engine
  has observed. Engine state is checkpointed with Unix `fork()`
  (`src/engine/main/fork.c`); on an edit, the driver resumes from the latest
  checkpoint taken before the changed bytes.
- Platforms: Linux and macOS. Not Windows-native, not WASM.
- Output: renders to its own SDL window via MuPDF (AGPL-3.0).
- Control: stdin/stdout protocol with a JSON mode (`EDITOR-PROTOCOL.md`),
  including a virtual file system for unsaved buffers.

## Decision

1. **Wrap existing engines** behind a `CompileBackend` interface. The
   compiler runs on the host (server or desktop); the browser only displays
   results.
2. **Two tracks:**
   - **Authoritative compile:** pdfLaTeX via latexmk. Always the source of
     truth for the final PDF.
   - **Live preview:** fast, possibly approximate, clearly labeled as preview.
3. **Speed levels**, implemented in order:

   | Level | Technique |
   |---|---|
   | L1 | Precompiled preamble format (`mylatexformat`), persistent warm worker, `\includeonly` for the edited chapter |
   | L2 | Instant in-editor rendering of the edited paragraph/equation (shared with visual mode) |
   | L3 | Checkpoint/resume incremental compilation (TeXpresso technique) |

4. **L3 path:** first integrate TeXpresso as a preview backend on
   Linux/macOS hosts. Its rendering output must be adapted to deliver pages to
   the browser. Later, evaluate porting its checkpoint technique to pdfTeX.

## Consequences

- TeXpresso preview output can differ from pdfLaTeX output (fonts,
  `fontenc`/`inputenc`, pdfTeX-specific primitives, line/page breaks).
- No L3 on Windows hosts or in-browser compilation.
- Each technique is a separate `CompileBackend` implementation or decorator.
