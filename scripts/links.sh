#!/bin/sh
# Prints the distinct links of an HTML file and writes them as a page.
# Usage: npm run links -- <html-file> [<output-page>]
# npm appends its arguments after the whole script line, so they are handled here.

if [ $# -lt 1 ]; then
  echo "usage: npm run links -- <html-file> [<output-page>]" >&2
  exit 2
fi

# A file name is user input: control characters (ESC, newline and the like) are dropped before it
# is printed. `tr` follows the locale: in a UTF-8 locale the 8-bit C1 controls may survive, so this
# is a guard against the common escape sequences and not a complete filter.
printable() {
  name="$(printf '%s' "$1" | tr -d '[:cntrl:]')"
  if [ -n "$name" ]; then
    printf '%s' "$name"
  else
    printf '%s' "(name without printable characters)"
  fi
}

if ! command -v htmlq >/dev/null 2>&1; then
  echo "error: htmlq is not installed or not on the PATH (install it, for example: brew install htmlq)" >&2
  exit 1
fi

if [ ! -f "$1" ] || [ ! -r "$1" ]; then
  echo "error: cannot read HTML file: $(printable "$1")" >&2
  exit 1
fi

bin="$(dirname -- "$0")/../src/bin.ts"

# The links go through a temp file and not straight into a pipe: a pipe hides the exit code of
# htmlq (POSIX sh has no pipefail), and a failed htmlq would then write an empty page.
tmp="$(mktemp)" || exit 1
trap 'rm -f "$tmp"' EXIT
trap 'exit 1' HUP INT TERM

if ! htmlq --attribute href 'a[href]' < "$1" > "$tmp"; then
  echo "error: htmlq failed on: $(printable "$1")" >&2
  exit 1
fi

if [ $# -ge 2 ]; then
  node "$bin" "$2" < "$tmp"
else
  node "$bin" < "$tmp"
fi
