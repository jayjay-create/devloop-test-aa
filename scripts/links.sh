#!/bin/sh
# Prints the distinct links of an HTML file and writes them as a page.
# Usage: npm run links -- [--sort] [--count] <html-file> [<output-page>]
# npm appends its arguments after the whole script line, so they are handled here.

# Names are printed with printf '%s', never echo: some shells' echo expands backslash sequences, so a
# name spelled \033[2J would reach the terminal as a real escape sequence.

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

# One pass over the arguments: --sort and --count may stand anywhere and are remembered, any other --* is an
# error (before htmlq is looked for and before a temp file is made), the rest stay the positionals.
want_sort=""
want_count=""
n=$#
while [ "$n" -gt 0 ]; do
  a="$1"
  shift
  case "$a" in
    --sort) want_sort=1 ;;
    --count) want_count=1 ;;
    --*)
      printf '%s\n' "error: unknown option: $(printable "$a") (only --sort and --count are supported)" >&2
      exit 2
      ;;
    *) set -- "$@" "$a" ;;
  esac
  n=$((n - 1))
done

if [ $# -lt 1 ]; then
  echo "usage: npm run links -- [--sort] [--count] <html-file> [<output-page>]" >&2
  exit 2
fi

if ! command -v htmlq >/dev/null 2>&1; then
  echo "error: htmlq is not installed or not on the PATH (install it, for example: brew install htmlq)" >&2
  exit 1
fi

if [ ! -f "$1" ] || [ ! -r "$1" ]; then
  printf '%s\n' "error: cannot read HTML file: $(printable "$1")" >&2
  exit 1
fi

bin="$(dirname -- "$0")/../src/bin.ts"

# The links go through a temp file and not straight into a pipe: a pipe hides the exit code of
# htmlq (POSIX sh has no pipefail), and a failed htmlq would then write an empty page.
tmp="$(mktemp)" || exit 1
trap 'rm -f "$tmp"' EXIT
trap 'exit 1' HUP INT TERM

if ! htmlq --attribute href 'a[href]' < "$1" > "$tmp"; then
  printf '%s\n' "error: htmlq failed on: $(printable "$1")" >&2
  exit 1
fi

# node gets the options that were given, then the output page if there is one.
have_page=""
page=""
if [ $# -ge 2 ]; then
  have_page=1
  page="$2"
fi
set --
if [ -n "$want_sort" ]; then set -- "$@" --sort; fi
if [ -n "$want_count" ]; then set -- "$@" --count; fi
if [ -n "$have_page" ]; then set -- "$@" "$page"; fi
node "$bin" "$@" < "$tmp"
