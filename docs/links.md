# The links program

The links program takes links, prints each distinct link once, and writes them as an HTML page. The links come from an HTML file (read with htmlq) or from stdin.

![Path from an HTML file through htmlq and the program to the written page](links.svg)

To regenerate the diagram from its source `docs/links.mmd`, run `npm run diagram` from the repository root. It needs `mmdc` from npm on the PATH (`npm install -g @mermaid-js/mermaid-cli`, see `docs/agents/environment.md`).

## Prerequisites

- Node, as given by `engines` in `package.json` (`>=22.18`). There is no build and there are no runtime dependencies.
- htmlq, for the call from an HTML file only: `brew install htmlq`.

## Output

Both calls do the same after the links are known:

- The distinct links are printed to stdout first, in input order, one per line.
- Then the page is written. It defaults to `links.html` in the current directory; pass an output page to write somewhere else.

## Call 1: from an HTML file

Run from the repository root:

```
npm run links -- <html-file> [<output-page>]
```

The script takes the `href` of every `a` element of the HTML file with htmlq and hands the links to the program. Example with `test/sample.html`:

```
$ npm run links -- test/sample.html

> links
> sh scripts/links.sh test/sample.html

https://example.org/a
/relative/page
https://example.org/b?x=1&y=2
```

`links.html` is written in the current directory. The link `https://example.org/a` appears twice in the sample and is printed once. With an output page:

```
$ npm run links -- test/sample.html page.html
```

prints the same links and writes `page.html`. The written page holds:

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
node src/bin.ts [<output-page>]
```

The input is one link per line (a trailing `\r` is dropped, empty lines are skipped). Example:

```
$ printf 'https://example.org/a\n/relative/page\nhttps://example.org/a\n' | node src/bin.ts
https://example.org/a
/relative/page
```

`links.html` is written in the current directory.

## Exit codes and messages

Messages go to stderr. In file names and system messages, control characters are dropped or replaced so that an error stays on one line.

| Exit | Message | Cause |
|---|---|---|
| 0 | - | The page was written. |
| 2 | `usage: npm run links -- <html-file> [<output-page>]` | `scripts/links.sh` was called without an HTML file. |
| 1 | `error: htmlq is not installed or not on the PATH (install it, for example: brew install htmlq)` | htmlq is not found. |
| 1 | `error: cannot read HTML file: <name>` | The HTML file does not exist or is not readable. |
| 1 | `error: htmlq failed on: <name>` | htmlq exited with an error on the file. |
| 1 | `error: cannot read stdin: <os message>` | Reading stdin failed. |
| 1 | `error: cannot write <target>: <os message>` | The output page could not be written. |

Examples, run once each:

```
$ sh scripts/links.sh test/sample.html      # PATH without htmlq
error: htmlq is not installed or not on the PATH (install it, for example: brew install htmlq)   (exit 1)

$ sh scripts/links.sh missing.html
error: cannot read HTML file: missing.html   (exit 1)

$ sh scripts/links.sh test/sample.html      # with an htmlq that exits 3
error: htmlq failed on: test/sample.html   (exit 1)

$ sh scripts/links.sh
usage: npm run links -- <html-file> [<output-page>]   (exit 2)

$ node src/bin.ts /nonexistent-dir/x.html < /dev/null
error: cannot write /nonexistent-dir/x.html: ENOENT: no such file or directory, open '/nonexistent-dir/x.html'   (exit 1)
```

The exit codes in parentheses are those of the command, not part of its output. The message for an unreadable stdin has no example here.
