import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { main } from "../src/main.ts";

function fakes(input: string, writeFile = async (_p: string, _d: string) => {}) {
  const written: Record<string, string> = {};
  let out = "";
  let err = "";
  return {
    written,
    get out() { return out; },
    get err() { return err; },
    run: (argv: string[]) =>
      main(
        argv,
        Readable.from([Buffer.from(input)]),
        { write: (s: string) => ((out += s), true) },
        async (p: string, d: string) => { await writeFile(p, d); written[p] = d; },
        { write: (s: string) => ((err += s), true) },
      ),
  };
}

test("empty stdin: returns 0 and writes an empty page to links.html", async () => {
  const f = fakes("");
  assert.equal(await f.run([]), 0);
  assert.ok(f.written["links.html"].includes("<ul></ul>"));
  assert.ok(!f.written["links.html"].includes("<li>"));
});

test("argv[0] is the output path", async () => {
  const f = fakes("a\n");
  assert.equal(await f.run(["out.html"]), 0);
  assert.deepEqual(Object.keys(f.written), ["out.html"]);
});

test("distinct links are printed and written", async () => {
  const f = fakes("a\nb\na\n");
  await f.run([]);
  assert.equal(f.out, "a\nb\n");
  assert.equal(f.written["links.html"].match(/<li>/g)?.length, 2);
});

test("a rejecting writeFile gives non-zero and one stderr line", async () => {
  const f = fakes("a\n", async () => { throw new Error("disk full"); });
  assert.notEqual(await f.run([]), 0);
  assert.equal(f.err.trimEnd().split("\n").length, 1);
  assert.ok(f.err.length > 0);
});
