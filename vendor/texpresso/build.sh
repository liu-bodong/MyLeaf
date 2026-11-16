#!/usr/bin/env bash
# Builds TeXpresso at a pinned upstream commit with MyLeaf's patches applied.
#
# Usage: vendor/texpresso/build.sh [output-dir]   (default: vendor/texpresso/build)
#
# Requires the build dependencies listed in vendor/texpresso/README.md.
set -euo pipefail

UPSTREAM=https://github.com/let-def/texpresso.git
COMMIT=e8df7709077b2f86f6e16e6c86ceefb86de06f8d

here="$(cd "$(dirname "$0")" && pwd)"
out="${1:-$here/build}"
src="$out/src"

if [ ! -d "$src/.git" ]; then
  git clone --quiet "$UPSTREAM" "$src"
fi
git -C "$src" fetch --quiet origin "$COMMIT"
git -C "$src" checkout --quiet --force "$COMMIT"
git -C "$src" clean --quiet -fdx

for patch in "$here"/*.patch; do
  git -C "$src" apply "$patch"
done

# getconf works on Linux and macOS (nproc is Linux-only).
jobs="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2)"
# Build libcommon.a first: under -j, `all` builds common, texpresso and
# texpresso-xetex at once, and the last two each archive libcommon.a too,
# so concurrent `ar` runs can corrupt it. Both targets generate
# Makefile.config first.
make -C "$src" -j"$jobs" common >/dev/null
make -C "$src" -j"$jobs" all >/dev/null
mkdir -p "$out/bin"
# Copy then rename, so binaries in use by running sessions can be replaced.
for binary in texpresso texpresso-xetex; do
  cp "$src/build/$binary" "$out/bin/.$binary.new"
  mv -f "$out/bin/.$binary.new" "$out/bin/$binary"
done
echo "Built $out/bin/texpresso and $out/bin/texpresso-xetex"
