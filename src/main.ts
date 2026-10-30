import { parseLinks, distinct, applyExclude, applyLimit, parseLimit, renderPage, consoleText } from "./core.ts";

type Writable = { write(s: string): unknown };

async function readAll(stdin: AsyncIterable<string | Uint8Array>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stdin) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString("utf8");
}

// Error output is one line: every control character (ESC, BEL, tab, newline, the C1 range) and
// U+2028/2029 in a path or an OS message becomes a space, so they cannot start a terminal escape sequence or a second line.
// Printable bidi and zero-width characters are left alone.
function sanitizeForStderr(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replaceAll(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ");
}

export async function main(
  argv: string[],
  stdin: AsyncIterable<string | Uint8Array>,
  stdout: Writable,
  writeFile: (path: string, data: string) => Promise<void>,
  stderr: Writable = process.stderr,
): Promise<number> {
  let sort = false;
  let count = false;
  const excludes: string[] = [];
  let title = "";
  let limitText: string | undefined;
  const positionals: string[] = [];
  for (const arg of argv) {
    if (arg === "--sort") sort = true;
    else if (arg === "--count") count = true;
    else if (arg.startsWith("--exclude=")) excludes.push(arg.slice("--exclude=".length));
    else if (arg.startsWith("--title=")) title = arg.slice("--title=".length);
    else if (arg.startsWith("--limit=")) limitText = arg.slice("--limit=".length);
    else if (arg.startsWith("--")) {
      stderr.write(
        `error: unknown option: ${sanitizeForStderr(arg)} (only --sort, --count, --exclude=GLOB, --title=TEXT and --limit=N are supported)\n`,
      );
      return 2;
    } else positionals.push(arg);
  }
  // A bad limit is refused before stdin is read, so nothing is consumed or written for it.
  let limit: number | undefined;
  if (limitText !== undefined) {
    limit = parseLimit(limitText);
    if (limit === undefined) {
      stderr.write(`error: invalid --limit: ${sanitizeForStderr(limitText)} (must be a whole number of at least 1)\n`);
      return 1;
    }
  }
  let input: string;
  try {
    input = await readAll(stdin);
  } catch (e) {
    stderr.write(`error: cannot read stdin: ${sanitizeForStderr(e)}\n`);
    return 1;
  }
  const distinctLinks = applyExclude(distinct(parseLinks(input)), excludes);
  // The default sort compares UTF-16 code units: uppercase before lowercase, the same on every machine (not localeCompare).
  const links = applyLimit(sort ? [...distinctLinks].sort() : distinctLinks, limit);
  if (count) stdout.write(`${String(links.length)}\n`);
  else {
    const text = consoleText(links);
    if (text !== "") stdout.write(`${text}\n`);
  }
  const target = positionals[0] ?? "links.html";
  try {
    await writeFile(target, renderPage(links, { title }));
  } catch (e) {
    stderr.write(`error: cannot write ${sanitizeForStderr(target)}: ${sanitizeForStderr(e)}\n`);
    return 1;
  }
  return 0;
}
