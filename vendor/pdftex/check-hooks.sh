#!/usr/bin/env bash
# Checks the stream hooks: compiles each document with the patched pdfTeX,
# hooks off and on, compares the PDFs byte for byte, and lists the files
# pdfTeX opened without going through the hooks (traced with strace).
#
# Usage: vendor/pdftex/check-hooks.sh <work-dir> <doc.tex>...
# Requires: vendor/pdftex/build.sh run first, TeX Live (kpsewhich), strace (Linux).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
pdftex="${PDFTEX:-$here/build/bin/pdftex}"
work="$(mkdir -p "$1" && cd "$1" && pwd)"
shift

# The patched binary has no texmf.cnf next to it; use the installed TeX Live's.
TEXMFCNF="$(kpsewhich -var-value TEXMFCNF)"
# Reproducible PDFs (no creation date, fixed ID), so they can be compared.
export TEXMFCNF SOURCE_DATE_EPOCH=0 FORCE_SOURCE_DATE=1

mkdir -p "$work/fmt"
(cd "$work/fmt" && "$pdftex" -ini -jobname=pdflatex -progname=pdflatex -etex pdflatex.ini </dev/null >/dev/null)

for doc in "$@"; do
  name="$(basename "$doc" .tex)"
  for mode in off on; do
    dir="$work/$name-$mode"
    rm -rf "$dir"
    mkdir -p "$dir"
    cp "$doc" "$dir/main.tex"
    hooks=()
    [ "$mode" = on ] && hooks=(MYLEAF_PDFTEX_HOOKS=1 "MYLEAF_PDFTEX_HOOK_LOG=$dir/hooks.log")
    (cd "$dir" && env "${hooks[@]}" strace -f -qq -o strace.txt -e trace=open,openat,creat \
      "$pdftex" -fmt="$work/fmt/pdflatex.fmt" -progname=pdflatex -interaction=nonstopmode \
      main.tex </dev/null >stdout.txt 2>&1) || echo "$name ($mode): pdfTeX exited with $?"
  done

  if cmp -s "$work/$name-off/main.pdf" "$work/$name-on/main.pdf"; then
    echo "$name: PDFs identical with hooks off and on"
  else
    echo "$name: PDFs DIFFER with hooks off and on"
  fi

  dir="$work/$name-on"
  # Successful opens as "read <path>" or "write <path>", without the leading ./
  # kpathsea adds for the current directory. Compared as lists with repeats, so
  # a file opened both through the hooks and outside them shows up.
  grep -v -E 'ENOENT|ENOTDIR|O_DIRECTORY' "$dir/strace.txt" |
    sed -n -E 's/.*"([^"]+)", (O_RDONLY)?.*/\2 \1/p' |
    sed -E 's/^O_RDONLY /read /; t; s/^ /write /' | sed 's# \./# #' | sort >"$dir/opened.txt"
  awk -F'\t' '$1 == "open" { print ($2 == "in" ? "read " : "write ") $4 }' "$dir/hooks.log" |
    sed 's# \./# #' | sort >"$dir/hooked.txt"
  echo "$name: $(wc -l <"$dir/hooked.txt") opens through the hooks; outside them:"
  comm -23 "$dir/opened.txt" "$dir/hooked.txt" |
    grep -v -E ' /(lib|lib64|usr/lib|proc|sys|dev)/|/etc/ld\.so|locale|gconv|/etc/localtime' |
    grep -v -F "$dir/hooks.log" | sed 's/^/  /'
done
