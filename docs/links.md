# The links program

The links program takes links, prints each distinct link once, and writes them as an HTML page. The links come from an HTML file (read with htmlq) or from stdin.

![Path from an HTML file through htmlq and the program to the written page](links.svg)

## Prerequisites

- Node, as given by `engines` in `package.json` (`>=22.18`). There is no build and there are no runtime dependencies.
- htmlq, for the call from an HTML file only: `brew install htmlq`.

## Output

Both calls do the same after the links are known:

- The distinct links are printed to stdout first, in input order, or sorted by character code (UTF-16 code units, so uppercase before lowercase) with `--sort`, one per line.
- Then the page is written. The output page defaults to `links.html` in the current directory; pass an output page to write somewhere else.

## Call 1: from an HTML file

Run from the repository root:

```
npm run links -- [--sort] <html-file> [<output-page>]
```

The script takes the `href` of every `a` element of the HTML file with htmlq and hands the links to the program. Other attributes, such as the `href` of a `link` element or the `src` of an image, are ignored.

The example uses `test/sample.html`. Its `a` elements point to `https://example.org/a` (twice), `/relative/page` and `https://example.org/b?x=1&amp;y=2`. The `&amp;` in the HTML source is printed as `&`.

```
$ npm run links -- test/sample.html

> links
> sh scripts/links.sh test/sample.html

https://example.org/a
/relative/page
https://example.org/b?x=1&y=2
```

The link that appears twice is printed once. With an output page, the same links are printed and the page is written to that name:

```
$ npm run links -- test/sample.html page.html
```

With `--sort` (anywhere among the arguments) the links are printed and written sorted by character code:

```
$ npm run links -- --sort test/sample.html

> links
> sh scripts/links.sh --sort test/sample.html

/relative/page
https://example.org/a
https://example.org/b?x=1&y=2
```

The written page (unsorted call) holds:

```html
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Links</title>
</head>
<body>
<ul>
<li><a href="https://example.org/a">https://example.org/a</a></li>
<li><a href="/relative/page">/relative/page</a></li>
<li><a href="https://example.org/b?x=1&amp;y=2">https://example.org/b?x=1&amp;y=2</a></li>
</ul>
</body>
</html>
```

## Call 2: over stdin

Run from the repository root:

```
node src/bin.ts [--sort] [<output-page>]
```

The input is one link per line (a trailing `\r` is dropped, empty lines are skipped). Example:

```
$ printf 'https://example.org/a\n/relative/page\nhttps://example.org/a\n' | node src/bin.ts
https://example.org/a
/relative/page
```

The links of `test/sample.html` can be fed in the same way. This is the htmlq call that `npm run links` makes, written as a pipe:

```
$ htmlq --attribute href 'a[href]' < test/sample.html | node src/bin.ts page.html
https://example.org/a
/relative/page
https://example.org/b?x=1&y=2
```

This writes the same page as the `page.html` of Call 1.

With `--sort` the links are printed and written sorted. `--sort` may stand anywhere among the arguments; giving it twice is harmless. Any other argument starting with `--` is an error, so a file name starting with `--` needs `./` in front (`./--name.html`).

```
$ printf 'b\na\nb\nB\n' | node src/bin.ts --sort out.html
B
a
b
```

## Exit codes and messages

Messages go to stderr, and an error stays on one line. `scripts/links.sh` drops control characters from the file name it prints; in a UTF-8 locale some 8-bit control characters may survive that filter. `src/main.ts` replaces every run of one or more control characters (tab, newline and the 8-bit range included) or U+2028/U+2029, in any mix, in a name or system message with a single space. `src/bin.ts` only starts that program.

| Exit | Message | Cause |
|---|---|---|
| 0 | - | The page was written. |
| 1 | `error: htmlq is not installed or not on the PATH (install it, for example: brew install htmlq)` | `scripts/links.sh`: htmlq is not found. |
| 1 | `error: cannot read HTML file: <name>` | `scripts/links.sh`: the HTML file does not exist, is not a regular file or is not readable. |
| 1 | `error: htmlq failed on: <name>` | `scripts/links.sh`: htmlq exited with an error on the file. |
| 1 | `error: cannot read stdin: <os message>` | `src/main.ts`: reading stdin failed. |
| 1 | `error: cannot write <target>: <os message>` | `src/main.ts`: the output page could not be written. |
| 2 | `error: unknown option: <arg> (only --sort is supported)` | `src/main.ts`: an argument starting with `--` other than `--sort`. |
| 2 | `error: unknown option: <arg> (only --sort is supported)` | `scripts/links.sh`: an argument starting with `--` other than `--sort`, checked before htmlq is looked for. |
| 2 | `usage: npm run links -- [--sort] <html-file> [<output-page>]` | `scripts/links.sh`: called without an HTML file. |

Examples:

```
$ sh scripts/links.sh test/sample.html    # with a PATH that has no htmlq
error: htmlq is not installed or not on the PATH (install it, for example: brew install htmlq)
# exit 1

$ sh scripts/links.sh missing.html
error: cannot read HTML file: missing.html
# exit 1

$ sh scripts/links.sh test/sample.html    # with an htmlq that exits 3
error: htmlq failed on: test/sample.html
# exit 1

$ sh scripts/links.sh
usage: npm run links -- [--sort] <html-file> [<output-page>]
# exit 2

$ node src/bin.ts --foo < /dev/null
error: unknown option: --foo (only --sort is supported)
# exit 2

$ node src/bin.ts /nonexistent-dir/x.html < /dev/null
error: cannot write /nonexistent-dir/x.html: ENOENT: no such file or directory, open '/nonexistent-dir/x.html'
# exit 1
```

## Regenerating the diagram

The diagram is generated from its source `docs/links.mmd`. Run `npm run diagram` from the repository root. It needs `mmdc` from npm on the PATH (`npm install -g @mermaid-js/mermaid-cli`).
