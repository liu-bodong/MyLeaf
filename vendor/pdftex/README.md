# pdfTeX (patched)

pdfTeX from TeX Live's sources, built from a pinned commit with the patches
in this directory applied. It is the engine for the pdfLaTeX live-preview
work (`docs/spikes/pdflatex-live-preview.md`). Nothing in MyLeaf uses it yet;
live preview still runs on TeXpresso (ADR 0012).

| File                  | Purpose                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| `build.sh`            | Fetches the pinned commit, applies `*.patch`, builds `build/bin/pdftex`                           |
| `stream-hooks.patch`  | Returns files opened through `openclose.c` as pass-through streams (`MYLEAF_PDFTEX_HOOKS`)        |
| `check-hooks.sh`      | Compiles documents with hooks off and on, compares the PDFs, lists files opened outside the hooks |
| `fixtures/images.tex` | PNG, JPEG and PDF images, for `check-hooks.sh`                                                    |

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

## Running

The binary has no `texmf.cnf` next to it. Point kpathsea at the installed
TeX Live's and make a format with the patched binary:

```bash
export TEXMFCNF="$(kpsewhich -var-value TEXMFCNF)"
vendor/pdftex/build/bin/pdftex -ini -jobname=pdflatex -progname=pdflatex -etex pdflatex.ini
MYLEAF_PDFTEX_HOOKS=1 vendor/pdftex/build/bin/pdftex -fmt=pdflatex -progname=pdflatex main.tex
```

`vendor/pdftex/check-hooks.sh <work-dir> <doc.tex>...` does this and also
traces opens with `strace` (Linux). The spike's findings came from:

```bash
vendor/pdftex/check-hooks.sh /tmp/hooks packages/compile-texlive/bench/paper.tex vendor/pdftex/fixtures/images.tex
```

`pnpm bench:pdftex-hooks` measures the
hooks' overhead.

## Build dependencies (Ubuntu 24.04)

```bash
sudo apt-get install build-essential texinfo
```

`texinfo` provides `makeinfo`, which the TeX Live build runs for its manuals.
A TeX Live installation (`texlive-latex-base` and the packages the documents
use) is needed to run it, and `strace` for `check-hooks.sh`.

## Build dependencies (macOS)

Not tested. The build needs Xcode's command line tools and `makeinfo`
(`brew install texinfo`); the `funopen` branch of the patch has not been
compiled.

## Updating

Change `COMMIT` in `build.sh`, rebuild, and regenerate the patch if it no
longer applies.
