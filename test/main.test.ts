import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { main } from "../src/main.ts";

function fakes(input: string | Buffer[], writeFile = async (_p: string, _d: string) => {}) {
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
        Readable.from(typeof input === "string" ? [Buffer.from(input)] : input),
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
  assert.equal(f.out, "");
});

test("a multibyte character split across stdin chunks survives", async () => {
  const bytes = Buffer.from("https://example.org/ä\n");
  const f = fakes([bytes.subarray(0, 21), bytes.subarray(21)]);
  assert.equal(await f.run([]), 0);
  assert.equal(f.out, "https://example.org/ä\n");
  assert.ok(f.written["links.html"].includes('<a href="https://example.org/ä">'));
});

test("a failing stdin gives non-zero and one stderr line naming stdin", async () => {
  const f = fakes("");
  const failing = (async function* () { throw new Error("boom\nline two"); })();
  const err: string[] = [];
  const code = await main([], failing, { write: () => true }, async () => {}, { write: (s: string) => (err.push(s), true) });
  assert.notEqual(code, 0);
  assert.equal(err.join("").trimEnd().split("\n").length, 1);
  assert.ok(err.join("").includes("cannot read stdin"));
  assert.ok(f.out === "");
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
  assert.notEqual(await f.run(["x/out.html"]), 0);
  assert.equal(f.err.trimEnd().split("\n").length, 1);
  assert.ok(f.err.includes("x/out.html") && f.err.includes("disk full"));
  assert.equal(f.out, "a\n");
});
