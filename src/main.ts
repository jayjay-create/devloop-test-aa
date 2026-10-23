import { parseLinks, distinct, renderPage, consoleText } from "./core.ts";

type Writable = { write(s: string): unknown };

async function readAll(stdin: AsyncIterable<string | Uint8Array>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stdin) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString("utf8");
}

// Error output is one line so that a caller reading stderr line by line sees one error.
function oneLine(msg: string): string {
  return msg.replaceAll(/[\r\n]+/g, " ");
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
    stderr.write(`error: cannot read stdin: ${oneLine(e instanceof Error ? e.message : String(e))}\n`);
    return 1;
  }
  const links = distinct(parseLinks(input));
  const text = consoleText(links);
  if (text !== "") stdout.write(text + "\n");
  const target = argv[0] ?? "links.html";
  try {
    await writeFile(target, renderPage(links));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    stderr.write(`error: cannot write ${target}: ${oneLine(msg)}\n`);
    return 1;
  }
  return 0;
}
