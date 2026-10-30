#!/bin/sh
# Runs npm run links with the settings of links.config.yaml in the project root: --sort when it says
# `sort: true`, and one --exclude=<pattern> for every pattern of its `exclude` list (globs: * is any text),
# and --title=<text> when `title` is a non-empty text, and --limit=<number> when `limit` is a whole number
# (a plain YAML integer; 0 or less is refused by the program, not here).
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
patterns=""
count=0
title=""
limit=""

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
  # An explicit template: measured on macOS, a bare mktemp put the file outside TMPDIR.
  errfile="$(mktemp "${TMPDIR:-/tmp}/links-config.XXXXXX")" || {
    echo "error: cannot create a temporary file to read yq's messages (check TMPDIR)" >&2
    exit 1
  }
  # Runs yq with one expression on the config file and leaves its answer in cfg_out. Not run in a
  # command substitution: an exit there would only end the substitution, and the script would go on.
  cfg_get() {
    cfg_out="$(yq "$1" "$config" 2>"$errfile")"
    status=$?
    detail="$(cat "$errfile")"
    if [ "$status" -ne 0 ]; then
      [ -n "$detail" ] || detail="$cfg_out"
      printf '%s\n' "error: yq failed on links.config.yaml (exit $status): $(printable "$detail")" >&2
      exit 1
    fi
  }

  cfg_get '.sort'
  value="$cfg_out"

  # exclude is nothing or a list of text. The type of the list and of every item are asked before the
  # patterns, so a number or a map never becomes an --exclude= argument.
  cfg_get '.exclude | tag'
  exclude_tag="$cfg_out"
  case "$exclude_tag" in
    '!!null') ;;
    '!!seq')
      cfg_get '.exclude[] | tag'
      # An empty list prints nothing; a here-document would still give the loop one empty line.
      # The loop counts the items: the count is what reads the patterns below, because the command
      # substitution strips trailing newlines and so loses trailing empty patterns.
      if [ -n "$cfg_out" ]; then
        while IFS= read -r item_tag; do
          if [ "$item_tag" != '!!str' ]; then
            echo "error: links.config.yaml: exclude must be a list of text" >&2
            exit 1
          fi
          count=$((count + 1))
        done <<EOF
$cfg_out
EOF
      fi
      # yq prints one pattern per line, so a pattern with a newline would read as two.
      cfg_get '[.exclude[] | select(contains("\n"))] | length'
      if [ "$cfg_out" != "0" ]; then
        echo "error: links.config.yaml: an exclude pattern must not contain a newline" >&2
        exit 1
      fi
      cfg_get '.exclude[]'
      patterns="$cfg_out"
      ;;
    *)
      echo "error: links.config.yaml: exclude must be a list of text" >&2
      exit 1
      ;;
  esac

  # title is nothing or text. A title with a newline is refused like a pattern with one: the value is read
  # as one command substitution, which strips trailing newlines, so it would not reach --title= as typed.
  cfg_get '.title | tag'
  case "$cfg_out" in
    '!!null') ;;
    '!!str')
      cfg_get '.title | contains("\n")'
      if [ "$cfg_out" != "false" ]; then
        echo "error: links.config.yaml: a title must not contain a newline" >&2
        exit 1
      fi
      cfg_get '.title'
      title="$cfg_out"
      ;;
    *)
      echo "error: links.config.yaml: title must be text" >&2
      exit 1
      ;;
  esac

  # limit is nothing or a YAML integer; a quoted "3", a float, text, a list or a bool is an error. An integer
  # of 0 or less, or one written as 0x10, passes here and is refused by the program (npm run links).
  cfg_get '.limit | tag'
  case "$cfg_out" in
    '!!null') ;;
    '!!int')
      cfg_get '.limit'
      limit="$cfg_out"
      ;;
    *)
      echo "error: links.config.yaml: limit must be a whole number of at least 1" >&2
      exit 1
      ;;
  esac

  # The --exclude, --title and --limit arguments go in front of the user's arguments: appended behind them, then
  # the user's arguments are moved behind the new ones.
  if [ "$count" -gt 0 ] || [ -n "$title" ] || [ -n "$limit" ]; then
    n=$#
    i=0
    # Exactly $count patterns: a read that finds no line left is a trailing empty pattern.
    while [ "$i" -lt "$count" ]; do
      IFS= read -r pattern || pattern=""
      set -- "$@" "--exclude=$pattern"
      i=$((i + 1))
    done <<EOF
$patterns
EOF
    # An empty title passes nothing, as a missing key does.
    if [ -n "$title" ]; then set -- "$@" "--title=$title"; fi
    if [ -n "$limit" ]; then set -- "$@" "--limit=$limit"; fi
    while [ "$n" -gt 0 ]; do
      a="$1"
      shift
      set -- "$@" "$a"
      n=$((n - 1))
    done
  fi

  # The file goes before the exec below, which replaces the shell and so never runs the EXIT trap.
  rm -f "$errfile"
  trap - EXIT HUP INT TERM
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
