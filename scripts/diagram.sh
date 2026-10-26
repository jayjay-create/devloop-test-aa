#!/bin/sh
# Renders docs/links.mmd (Mermaid) into docs/links.svg and docs/links.png with mmdc.
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
target_svg="$docs/links.svg"
target_png="$docs/links.png"

if [ ! -f "$input" ]; then
  echo "error: docs/links.mmd is missing" >&2
  exit 1
fi

# mv would move the file into a directory of that name and still exit 0.
if [ -d "$target_svg" ]; then
  echo "error: docs/links.svg is a directory" >&2
  exit 1
fi
if [ -d "$target_png" ]; then
  echo "error: docs/links.png is a directory" >&2
  exit 1
fi

# Both renders go to a temp directory and replace the committed files only after both succeeded and wrote something,
# so a failed render of either format leaves SVG and PNG as they were. mmdc wants the output name to end in the
# format, and POSIX mktemp has no suffix, so the files live in a temp directory. That directory sits next to the
# targets: the final mv is then a rename on one filesystem and cannot leave a half-copied file behind.
tmpdir="$(mktemp -d "$docs/.diagram.XXXXXX")" || {
  echo "error: cannot create a temp directory in docs/" >&2
  exit 1
}
trap 'rm -rf "$tmpdir"' EXIT
trap 'exit 1' HUP INT TERM

# render <format>: renders the input into the temp directory as links.<format>, mmdc's default size and no other option.
render() {
  if ! mmdc -i "$input" -o "$tmpdir/links.$1" -e "$1"; then
    echo "error: mmdc failed rendering docs/links.mmd" >&2
    exit 1
  fi
  if [ ! -s "$tmpdir/links.$1" ]; then
    echo "error: mmdc wrote no output for docs/links.mmd" >&2
    exit 1
  fi
}

render png
render svg

# Two renames are not atomic as a pair: only a failing second mv (permissions, a full disk) leaves the new SVG beside the
# old PNG. Both renders succeeded and both targets are known not to be directories before the first mv.
if ! mv -f "$tmpdir/links.svg" "$target_svg"; then
  echo "error: cannot replace docs/links.svg" >&2
  exit 1
fi
if ! mv -f "$tmpdir/links.png" "$target_png"; then
  echo "error: cannot replace docs/links.png" >&2
  exit 1
fi
