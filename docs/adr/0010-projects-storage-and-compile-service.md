# 0010. Projects, storage and the compile service (phase 1)

- Status: Accepted
- Date: 2026-11-14

## Context

Phase 1 delivers single-user editing: projects with files, pdfLaTeX
compilation, a PDF viewer and SyncTeX navigation. There is no
authentication yet.

## Decision

### Projects and files

- `@myleaf/project` (domain) defines `ProjectPath`, a validated relative
  `/`-separated path with no empty, `.` or `..` segments, no `\`, `:` or
  control characters. Every path from a client is parsed into a
  `ProjectPath` before use; adapters re-check containment.
- Port `ProjectStore`; adapter `@myleaf/storage-fs` stores each project as
  plain files (`<data>/projects/<uuid>/files/...`) plus `project.json`.
  Plain files keep projects usable by TeX, Git and other tools. Writes are
  atomic (temp file + rename).

### Compilation

- Port `CompileBackend` (`@myleaf/compile`); adapter
  `@myleaf/compile-texlive` runs `latexmk` and the `synctex` CLI.
- The compile request carries the complete source tree. The server
  currently passes the stored files; later it will pass projections (e.g.
  with suggestions accepted, ADR 0005) without changing the port.
- Each project has a build workspace (`<data>/builds/<id>/src` and `out`).
  Only changed files are rewritten, so `latexmk` recompiles incrementally.
- Compiles of one project are serialized.
- Log diagnostics are parsed from the engine log, which is written unwrapped
  (`max_print_line=10000`) and with `-file-line-error`.

### Hardening (not a sandbox)

- `latexmk -norc`: project `latexmkrc` files (Perl code) are not executed.
- `-no-shell-escape`.
- `openin_any=p`, `openout_any=p`, `TEXMFOUTPUT=<out>`: TeX cannot read or
  write files outside the workspace and the TeX distribution (verified:
  `\input{/etc/hostname}` fails).
- Compiles are killed after 60 s (whole process group).

Remaining risk: TeX still runs as the server's user, without resource limits
beyond the timeout. Until a container sandbox exists, only run the server for
people you trust. The server binds to `127.0.0.1` by default and has no
authentication.

### HTTP API

- `@myleaf/api` holds the route paths and DTO types used by server and web.
- File content is transferred as raw bytes (`application/octet-stream`).
- Request bodies are validated with JSON schemas; unknown properties are
  rejected. Domain errors map to 400 / 404 / 409.

## Consequences

- Swapping storage (e.g. a database) or the compiler (e.g. a container
  sandbox, Tectonic, TeXpresso) is a new adapter passing the same contract.
- Project-local `latexmkrc` customisation is unsupported.
- Warnings without `file:line:` context are reported without a file.
