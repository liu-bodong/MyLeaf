# TeXpresso (patched)

[TeXpresso](https://github.com/let-def/texpresso) (MIT) provides live,
incremental LaTeX rendering. MyLeaf builds it from a pinned upstream commit
with the patches in this directory applied (see ADR 0012).

| File                           | Purpose                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `build.sh`                     | Clones the pinned commit, applies `*.patch`, builds into `build/bin/`        |
| `headless-export.patch`        | Writes each displayed page as SVG (or PNG) and announces it on stdout        |
| `input-extension-lookup.patch` | Resolves `\input{name}` through the driver, so edits to included files apply |

## Included files

XeTeX first asks for `\input{sections/intro}` under the bare name. Upstream,
when the driver does not know that name, the engine adds the extension and
reads the file from disk itself, bypassing the contents sent with `open` or
`open-base64`. `input-extension-lookup.patch` asks the driver for each
`name + extension` before that disk fallback.

## Headless export

With `TEXPRESSO_EXPORT_DIR=<dir>`, every page TeXpresso displays is written
atomically to `<dir>/page-<n>.svg` and announced on stdout (JSON mode) as:

```json
["page-exported", 4, "/path/to/page-4.svg", 2]
```

`TEXPRESSO_EXPORT_FORMAT=png` writes 2x PNG instead. Run without a display
with `SDL_VIDEODRIVER=dummy`.

The SVG output contains `data-text` attributes that may hold control
characters, which are invalid XML; consumers must strip them.

## Build dependencies (Ubuntu 24.04)

```bash
sudo apt-get install build-essential pkg-config libsdl2-dev libmupdf-dev libmujs-dev libfreetype-dev libgumbo-dev libjbig2dec0-dev libjpeg-dev libopenjp2-7-dev libssl-dev libfontconfig-dev libleptonica-dev libharfbuzz-dev libgraphite2-dev libicu-dev libpng-dev zlib1g-dev texlive-xetex
```

## Build dependencies (macOS)

From TeXpresso's INSTALL.md (`mupdf-tools`, `SDL2`) and its Makefiles: the
frontend links mupdf, SDL2, harfbuzz, freetype, libjpeg and zlib from
`brew --prefix`; the engine uses `pkg-config` for freetype2, harfbuzz,
graphite2, fontconfig and libpng, and links `icu4c`. A TeX distribution with
XeTeX must be on `PATH` (e.g. MacTeX).

```bash
brew install pkg-config mupdf-tools sdl2 icu4c freetype harfbuzz graphite2 fontconfig libpng jpeg-turbo
```

Then run `vendor/texpresso/build.sh`. This list is not tested by MyLeaf's
CI, which runs on Linux.

## Updating

Change `COMMIT` in `build.sh`, rebuild, and regenerate the patch if it no
longer applies. If the patches grow, switch to a fork added as a git submodule.
