import { parseLinks, distinct, renderPage, consoleText } from "./core.ts";

type Writable = { write(s: string): unknown };

async function readAll(stdin: AsyncIterable<string | Uint8Array>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stdin) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString("utf8");
}

// Error output is one line of plain text: a caller reading stderr line by line sees one error,
// and a path or OS message cannot inject terminal escape sequences or extra lines.
function describe(e: unknown): string {
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
    stderr.write(`error: cannot read stdin: ${describe(e)}\n`);
    return 1;
  }
  const links = distinct(parseLinks(input));
  const text = consoleText(links);
  if (text !== "") stdout.write(text + "\n");
  const target = argv[0] ?? "links.html";
  try {
    await writeFile(target, renderPage(links));
  } catch (e) {
    stderr.write(`error: cannot write ${describe(target)}: ${describe(e)}\n`);
    return 1;
  }
  return 0;
}
