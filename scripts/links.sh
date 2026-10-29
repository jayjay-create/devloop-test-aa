#!/bin/sh
# Prints the distinct links of an HTML file and writes them as a page.
# Usage: npm run links -- [--sort] [--count] [--exclude=GLOB] <html-file> [<output-page>]
# --exclude=GLOB (repeatable, `=` form only) is passed on to node unchanged; scripts/links-config.sh uses it.
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

# --sort, --count and --exclude=GLOB may stand anywhere; the other arguments keep their order by being rotated.
# Any other --* is an error before htmlq is looked for. An --exclude=GLOB stays among the arguments for now
# (it can never be taken for a file name: every --* is an option) and is picked out below.
want_sort=""
want_count=""
n=$#
while [ "$n" -gt 0 ]; do
  a="$1"
  shift
  case "$a" in
    --sort) want_sort=1 ;;
    --count) want_count=1 ;;
    --exclude=*) set -- "$@" "$a" ;;
    --*)
      printf '%s\n' "error: unknown option: $(printable "$a") (only --sort, --count and --exclude=GLOB are supported)" >&2
      exit 2
      ;;
    *) set -- "$@" "$a" ;;
  esac
  n=$((n - 1))
done

# The first two other arguments are the HTML file and the output page.
npos=0
file=""
page=""
for a in "$@"; do
  case "$a" in
    --exclude=*) ;;
    *)
      npos=$((npos + 1))
      if [ "$npos" -eq 1 ]; then file="$a"; fi
      if [ "$npos" -eq 2 ]; then page="$a"; fi
      ;;
  esac
done

if [ "$npos" -lt 1 ]; then
  echo "usage: npm run links -- [--sort] [--count] [--exclude=GLOB] <html-file> [<output-page>]" >&2
  exit 2
fi

if ! command -v htmlq >/dev/null 2>&1; then
  echo "error: htmlq is not installed or not on the PATH (install it, for example: brew install htmlq)" >&2
  exit 1
fi

if [ ! -f "$file" ] || [ ! -r "$file" ]; then
  printf '%s\n' "error: cannot read HTML file: $(printable "$file")" >&2
  exit 1
fi

bin="$(dirname -- "$0")/../src/bin.ts"

# The links go through a temp file and not straight into a pipe: a pipe hides the exit code of
# htmlq (POSIX sh has no pipefail), and a failed htmlq would then write an empty page.
tmp="$(mktemp)" || exit 1
trap 'rm -f "$tmp"' EXIT
trap 'exit 1' HUP INT TERM

if ! htmlq --attribute href 'a[href], area[href]' < "$file" > "$tmp"; then
  printf '%s\n' "error: htmlq failed on: $(printable "$file")" >&2
  exit 1
fi

# node gets the options that were given, then the output page if there is one.
# Only the --exclude arguments stay in "$@"; the rest were read above.
n=$#
while [ "$n" -gt 0 ]; do
  a="$1"
  shift
  case "$a" in
    --exclude=*) set -- "$@" "$a" ;;
  esac
  n=$((n - 1))
done
if [ -n "$want_count" ]; then set -- --count "$@"; fi
if [ -n "$want_sort" ]; then set -- --sort "$@"; fi
if [ "$npos" -ge 2 ]; then set -- "$@" "$page"; fi
node "$bin" "$@" < "$tmp"
