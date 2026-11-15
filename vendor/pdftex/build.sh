#!/usr/bin/env bash
# Builds pdfTeX from TeX Live sources at a pinned commit with MyLeaf's
# patches applied (docs/spikes/pdflatex-live-preview.md).
#
# Usage: vendor/pdftex/build.sh [output-dir]   (default: vendor/pdftex/build)
#
# Requires the build dependencies listed in vendor/pdftex/README.md.
set -euo pipefail

# GitHub mirror of TeX Live's Subversion repository.
UPSTREAM=https://github.com/TeX-Live/texlive-source.git
# Tag texlive-2023.0 (pdfTeX 1.40.25), the TeX Live release Ubuntu 24.04 ships.
COMMIT=0d0bb3a2401e8825b4987eee51e8ef469eb8c3fc

here="$(cd "$(dirname "$0")" && pwd)"
out="${1:-$here/build}"
src="$out/src"
obj="$out/obj"

if [ ! -d "$src/.git" ]; then
  git init --quiet "$src"
  git -C "$src" remote add origin "$UPSTREAM"
fi
# The repository is large (~500 MB per checkout); fetch only the pinned commit.
git -C "$src" fetch --quiet --depth 1 origin "$COMMIT"
git -C "$src" checkout --quiet --force "$COMMIT"
git -C "$src" clean --quiet -fdx

for patch in "$here"/*.patch; do
  git -C "$src" apply "$patch"
done

# Only pdfTeX and the libraries it needs (kpathsea, xpdf, libpng, zlib).
mkdir -p "$obj"
(
  cd "$obj"
  "$src/configure" --cache-file=config.cache --prefix=/nonexistent \
    --disable-all-pkgs --enable-web2c --enable-pdftex \
    --disable-tex --disable-etex --disable-ptex --disable-eptex \
    --disable-uptex --disable-euptex --disable-aleph --disable-hitex \
    --disable-xetex --disable-luatex --disable-luajittex --disable-luahbtex \
    --disable-luajithbtex --disable-mp --disable-pmp --disable-upmp \
    --disable-mf --disable-mf-nowin --disable-synctex \
    --without-x --disable-shared --disable-native-texlive-build \
    --enable-silent-rules >configure.log
)
# getconf works on Linux and macOS (nproc is Linux-only).
jobs="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2)"
make -C "$obj" -j"$jobs" >"$obj/make.log"

mkdir -p "$out/bin"
# Copy then rename, so a binary in use can be replaced.
cp "$obj/texk/web2c/pdftex" "$out/bin/.pdftex.new"
mv -f "$out/bin/.pdftex.new" "$out/bin/pdftex"
echo "Built $out/bin/pdftex"
