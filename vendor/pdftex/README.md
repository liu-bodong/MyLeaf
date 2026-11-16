# pdfTeX (patched)

pdfTeX from TeX Live's sources, built from a pinned commit with the patches
in this directory applied. It is the engine for the pdfLaTeX live-preview
work (`docs/spikes/pdflatex-live-preview.md`). Live preview uses it with
`MYLEAF_LIVE_ENGINE=pdftex` (`packages/live-pdftex`); the default is still
TeXpresso (ADR 0012).

| File                        | Purpose                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `build.sh`                  | Fetches the pinned commit, applies `*.patch`, builds `build/bin/pdftex`                              |
| `stream-hooks.patch`        | Returns files opened through `openclose.c` as pass-through streams (`MYLEAF_PDFTEX_HOOKS`)           |
| `warm-fork.patch`           | Level 2: pauses at a line of the main file and forks a child per edit (`MYLEAF_PDFTEX_PAUSE_OFFSET`) |
| `macos-target-os-mac.patch` | Lets the bundled zlib and libpng compile with current macOS SDKs                                     |
| `check-hooks.sh`            | Compiles documents with hooks off and on, compares the PDFs, lists files opened outside the hooks    |
| `fixtures/images.tex`       | PNG, JPEG and PDF images, for `check-hooks.sh`                                                       |

## Source

`build.sh` fetches tag `texlive-2023.0` (pdfTeX 1.40.25) from
[TeX-Live/texlive-source](https://github.com/TeX-Live/texlive-source), the
GitHub mirror of TeX Live's Subversion repository. This is the TeX Live
release Ubuntu 24.04 ships, which CI and the authoritative compile use, so
the patched engine reads the same macro packages and fonts as the system
`pdflatex`. Only that commit is fetched (about 500 MB checked out); the
build configures pdfTeX alone with its bundled libraries.

## Stream hooks

With `MYLEAF_PDFTEX_HOOKS` set, every file that `open_input` and
`open_output` (`texk/web2c/lib/openclose.c`) open is returned as a custom
`FILE*` stream (`fopencookie` on Linux, `funopen` on macOS) that passes
reads, writes and seeks through to the real file. Without the variable the
binary behaves like stock pdfTeX. With `MYLEAF_PDFTEX_HOOK_LOG=<file>`, each
open and close is logged as tab-separated lines:

```
open	in	26	/usr/share/texlive/texmf-dist/tex/latex/base/article.cls
open	out	-1	main.pdf
close	main.pdf	0	108667
```

(`26` is kpathsea's format number; `close` gives bytes read and written.)

Format files are not hooked: zlib reads and writes them through the file
descriptor (`gzdopen(fileno(f))`), which a custom stream does not have. The
patch adds `open_dump_output` for `wopenout` for that reason.

The pass-through is the place where a later step connects a driver
(TeXpresso-style I/O). Which files do not go through these hooks is listed in
the spike notes.

## Warm fork (levels 2 and 3)

`warm-fork.patch` applies on top of `stream-hooks.patch`. With
`MYLEAF_PDFTEX_HOOKS`, `MYLEAF_PDFTEX_PAUSE_OFFSET=<n>` and
`MYLEAF_PDFTEX_CONTROL_FD=<fd>`, pdfTeX runs the preamble, and when it is
about to read byte `<n>` of the main file it stops and serves commands on
`<fd>`. `<n>` must be the start of a line; live preview uses the line after
`\begin{document}`, so the engine has also run `\begin{document}` (and read
the `.aux`). Each
`run` forks a child that reads the rest of the main file from a new file
and writes all output (including a copy of the log so far) to its own
directory. Messages are lines of tab-separated fields:

| Direction       | Message                                                              | Meaning                                                            |
| --------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| engine → driver | `input <path>`                                                       | A file read before the pause (preamble dependencies)               |
| engine → driver | `ready`                                                              | Paused before byte `<n>`                                           |
| driver → engine | `run <id> <main-file> <output-dir> [<first> <last> [<every> <max>]]` | Fork a child; its bytes before the pause must equal the original's |
| engine → driver | `started <id> <pid>`                                                 | The child's process (to cancel the run, the driver kills it)       |
| engine → driver | `read <path>`                                                        | A file a child opened                                              |
| engine → driver | `page <id> <n> <dir>`                                                | Page `<n>` (in `<first>`–`<last>`) is in `<dir>`'s PDF (level 3)   |
| engine → driver | `file <pid> <bytes> <eof> <path>`                                    | Snapshot `<pid>` read `<bytes>` of `<path>` (`<eof>`: to its end)  |
| engine → driver | `snapshot <id> <n> <pos> <pid> <child-pid>`                          | A snapshot after page `<n>` and `<pos>` bytes (level 3)            |
| engine → driver | `done <id> <status>`                                                 | The child exited (exit status, or minus the signal)                |
| engine → driver | `resumed <pid>`                                                      | That process (engine or snapshot) reads commands again             |

With `<first>` and `<last>` (level 3, page-by-page output), each time the
child ships out a page in that range it forks a finisher: a copy that closes
the PDF right there (pages 1 to `<n>`, as pdfTeX's end of job writes it) in
`<output-dir>/page-<n>/`, says `page`, and exits. The driver can show page
`<n>` before the rest of the document is typeset. Finishers run alongside the
child, so a `page` line can come after the run's `done`, and out of order.
The hook is in pdfTeX's `ship_out` (`pdftex.web`).

With `MYLEAF_PDFTEX_SNAPSHOTS` as well (level 3), the first time the child
reads a TeX input (the main file, or an `\input`'d file; they are read in
blocks of 512 bytes) after a shipout, it forks: the new process goes on
typesetting, and the old one stays paused as a snapshot of the state after
`<pos>` bytes of the main file. Before `snapshot`, it sends a `file` line
for each input its run has read so far, open or closed (the main file
included, under its original name): the bytes read, and whether it read to
the end. A `run` sent to a snapshot resumes from there; for each of those
files, the new content's first `<bytes>` must be the old one's (and, with
`<eof>` 1, nothing may follow), and other files must not have changed, apart
from files the snapshot had not opened yet (the driver knows these from
`read` lines; images are not opened through the hooks and have none). The
new child opens each input that was open at the snapshot again, by name, at
the position read so far. With `<every>` and `<max>`, the child takes
snapshots only after pages that are multiples of `<every>`, and at most
`<max>` of them (`0`: none); the driver uses them to bound the number of
snapshot processes. The engine and its
snapshots form a chain, and only the last paused process reads `<fd>`: each
waits for its child to exit, then says `done` (for its child's run) and
`resumed`. To run from snapshot _k_, the driver kills the snapshots after it
(and a running child) and waits for `resumed` with _k_'s pid; the processes
after a killed one exit too. Outputs are copied from their descriptors (they
are opened for reading as well), so a snapshot still works after the driver
deleted its run's directory.

With `-synctex=-1` (uncompressed), the `.synctex` file is wrapped like the
other outputs (`synctex.c`): each child and finisher writes its own copy,
with the engine's records so far, and renames it from `<job>.synctex(busy)`
to `<job>.synctex` in its own directory at the end. The `synctex` tool then
maps between the source and that directory's PDF. Compressed SyncTeX
(`-synctex=1`) is not wrapped, so all runs would write to one file.

The child's terminal output goes to `<output-dir>/terminal.txt`. Files the
child reads (`.aux`, included files, images) come from disk: the driver
writes them before `run`. When the preamble or a file in an `input` line
changes, the driver starts a new engine. Closing `<fd>` stops the process
that reads it; the driver kills the engine's process group to stop the rest.

## Running

The binary is not installed with TeX Live, so kpathsea cannot find TeX
Live's files from the binary's location (TeX Live's own `texmf.cnf`, as on
MacTeX, derives its trees from `$SELFAUTOPARENT` and friends). Take
`TEXMFCNF`, `TEXMFROOT` and `TEXMFLOCAL` from the installed TeX Live, as
live preview does (`kpathseaEnv` in `packages/live-pdftex`), and make a
format with the patched binary:

```bash
for v in TEXMFCNF TEXMFROOT TEXMFLOCAL; do export "$v=$(kpsewhich -var-value "$v")"; done
vendor/pdftex/build/bin/pdftex -ini -jobname=pdflatex -progname=pdflatex -etex pdflatex.ini
MYLEAF_PDFTEX_HOOKS=1 vendor/pdftex/build/bin/pdftex -fmt=pdflatex -progname=pdflatex main.tex
```

`vendor/pdftex/check-hooks.sh <work-dir> <doc.tex>...` does this and also
traces opens with `strace` (Linux). The spike's findings came from:

```bash
vendor/pdftex/check-hooks.sh /tmp/hooks packages/compile-texlive/bench/paper.tex vendor/pdftex/fixtures/images.tex
```

`pnpm bench:pdftex-hooks` measures the
hooks' overhead, and `pnpm bench:pdftex-warm` the level 2 and 3 engine.

## Build dependencies (Ubuntu 24.04)

```bash
sudo apt-get install build-essential texinfo
```

`texinfo` provides `makeinfo`, which the TeX Live build runs for its manuals.
A TeX Live installation (`texlive-latex-base` and the packages the documents
use) is needed to run it, and `strace` for `check-hooks.sh`.

## Build dependencies (macOS)

The build needs Xcode's command line tools and `makeinfo`
(`brew install texinfo`). TeX Live 2023's bundled zlib 1.2.13 and libpng 1.6.39 take
`TARGET_OS_MAC`, which current macOS SDKs always define, to mean classic
Mac OS (zlib defines `fdopen` as `NULL`, libpng includes `<fp.h>`);
`macos-target-os-mac.patch` removes those two checks, as zlib 1.3 and
libpng 1.6.40 did upstream. It changes nothing on Linux.

Built and run on the owner's Mac against MacTeX 2025 (2026-11-15): the
format builds and a test document gives the same PDF with the hooks off and
on (the `funopen` branch), and the live-pdftex tests pass with the warm
fork.

The warm fork forks inside a stdio read of the main file, which holds that
stream's lock. On macOS the child's thread cannot release a lock taken by
the parent's thread, so without care the child blocks on its next read;
`warm-fork.patch` releases the lock across `fork()`.

## Updating

Change `COMMIT` in `build.sh`, rebuild, and regenerate the patch if it no
longer applies.
