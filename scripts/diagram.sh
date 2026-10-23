#!/bin/sh
# Renders docs/links.mmd (Mermaid) into docs/links.svg with mmdc.
# Usage: npm run diagram

if [ $# -ge 1 ]; then
  echo "usage: npm run diagram" >&2
  exit 2
fi

# Checked first: a PATH without mmdc may also lack dirname and mktemp.
if ! command -v mmdc >/dev/null 2>&1; then
  echo "error: mmdc is not installed or not on the PATH (install it, for example: npm install -g @mermaid-js/mermaid-cli)" >&2
  exit 1
fi

docs="$(dirname -- "$0")/../docs"
input="$docs/links.mmd"
target="$docs/links.svg"

if [ ! -f "$input" ]; then
  echo "error: docs/links.mmd is missing" >&2
  exit 1
fi

# mv would move the file into a directory of that name and still exit 0.
if [ -d "$target" ]; then
  echo "error: docs/links.svg is a directory" >&2
  exit 1
fi

# The render goes to a temp file and replaces the SVG only after mmdc succeeded and wrote something, so a
# failed render leaves the committed SVG as it was. mmdc wants the output name to end in .svg, and POSIX
# mktemp has no suffix, so the file lives in a temp directory. That directory sits next to the target:
# the final mv is then a rename on one filesystem and cannot leave a half-copied SVG behind.
tmpdir="$(mktemp -d "$docs/.diagram.XXXXXX")" || {
  echo "error: cannot create a temp directory in docs/" >&2
  exit 1
}
tmp="$tmpdir/links.svg"
trap 'rm -rf "$tmpdir"' EXIT
trap 'exit 1' HUP INT TERM

if ! mmdc -i "$input" -o "$tmp" -e svg; then
  echo "error: mmdc failed rendering docs/links.mmd" >&2
  exit 1
fi

if [ ! -s "$tmp" ]; then
  echo "error: mmdc wrote no output for docs/links.mmd" >&2
  exit 1
fi

if ! mv -f "$tmp" "$target"; then
  echo "error: cannot replace docs/links.svg" >&2
  exit 1
fi
