import { parseLinks, distinct, renderPage, consoleText } from "./core.ts";

type Writable = { write(s: string): unknown };

async function readAll(stdin: AsyncIterable<string | Uint8Array>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stdin) chunks.push(typeof c === "string" ? Buffer.from(c) : Buffer.from(c));
  return Buffer.concat(chunks).toString("utf8");
}

export async function main(
  argv: string[],
  stdin: AsyncIterable<string | Uint8Array>,
  stdout: Writable,
  writeFile: (path: string, data: string) => Promise<void>,
  stderr: Writable = process.stderr,
): Promise<number> {
  const links = distinct(parseLinks(await readAll(stdin)));
  const text = consoleText(links);
  if (text !== "") stdout.write(text + "\n");
  const target = argv[0] ?? "links.html";
  try {
    await writeFile(target, renderPage(links));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    stderr.write(`error: cannot write ${target}: ${msg.replaceAll("\n", " ")}\n`);
    return 1;
  }
  return 0;
}
