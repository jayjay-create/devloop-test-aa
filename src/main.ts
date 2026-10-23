import { parseLinks, distinct, renderPage, consoleText } from "./core.ts";

type Writable = { write(s: string): unknown };

async function readAll(stdin: AsyncIterable<string | Uint8Array>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stdin) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString("utf8");
}

// Error output is one line: control characters (ESC, BEL, newlines, C1, U+2028/2029) in a path or an
// OS message become spaces, so they cannot start a terminal escape sequence or a second line.
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
  let input: string;
  try {
    input = await readAll(stdin);
  } catch (e) {
    stderr.write(`error: cannot read stdin: ${sanitizeForStderr(e)}\n`);
    return 1;
  }
  const links = distinct(parseLinks(input));
  const text = consoleText(links);
  if (text !== "") stdout.write(text + "\n");
  const target = argv[0] ?? "links.html";
  try {
    await writeFile(target, renderPage(links));
  } catch (e) {
    stderr.write(`error: cannot write ${sanitizeForStderr(target)}: ${sanitizeForStderr(e)}\n`);
    return 1;
  }
  return 0;
}
