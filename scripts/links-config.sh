#!/bin/sh
# Runs npm run links with --sort when links.config.yaml in the project root says `sort: true`.
# Usage: npm run links:config -- <html-file> [<output-page>]
# Needs yq (Mike Farah's) when the config file exists: brew install yq

# Names and yq output are printed with printf '%s', never echo (see docs/agents/standards.md).
# Control characters are dropped first, so the text cannot start a terminal escape sequence.
# `tr` follows the locale: in a UTF-8 locale the 8-bit C1 controls may survive. Own copy of the
# function in scripts/links.sh, which cannot be sourced.
printable() {
  name="$(printf '%s' "$1" | tr -d '[:cntrl:]')"
  if [ -n "$name" ]; then
    printf '%s' "$name"
  else
    printf '%s' "(no printable characters)"
  fi
}

root="$(cd -- "$(dirname -- "$0")/.." && pwd)" || exit 1
config="$root/links.config.yaml"
value="null"

if [ -f "$config" ]; then
  if ! command -v yq >/dev/null 2>&1; then
    echo "error: yq is not installed or not on the PATH, but links.config.yaml needs it (install it, for example: brew install yq)" >&2
    exit 1
  fi
  # yq's stderr goes to a file of its own: a warning from a yq that succeeded must not become part of
  # the value. No pipe either: a pipe would hide the exit code of yq (POSIX sh has no pipefail).
  # The traps stand before the file exists, so no signal can find it without them; a signal ends the
  # run with 128 plus its number, and the EXIT trap removes the file.
  errfile=""
  trap 'rm -f "$errfile"' EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  # An explicit template: a bare mktemp ignores TMPDIR on macOS.
  errfile="$(mktemp "${TMPDIR:-/tmp}/links-config.XXXXXX")" || {
    echo "error: cannot create a temporary file to read yq's messages (check TMPDIR)" >&2
    exit 1
  }
  value="$(yq '.sort' "$config" 2>"$errfile")"
  status=$?
  detail="$(cat "$errfile")"
  # The file goes before the exec below, which replaces the shell and so never runs the EXIT trap.
  rm -f "$errfile"
  trap - EXIT HUP INT TERM
  if [ "$status" -ne 0 ]; then
    [ -n "$detail" ] || detail="$value"
    printf '%s\n' "error: yq failed on links.config.yaml (exit $status): $(printable "$detail")" >&2
    exit 1
  fi
fi

case "$value" in
  true)
    exec npm run links -- --sort "$@"
    ;;
  false | null)
    exec npm run links -- "$@"
    ;;
  *)
    printf '%s\n' "error: links.config.yaml: sort must be true or false, got: $(printable "$value")" >&2
    exit 1
    ;;
esac
