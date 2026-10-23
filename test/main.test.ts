import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { main } from "../src/main.ts";

function fakes(input: string | Buffer[] | AsyncIterable<Buffer>, writeFile = async (_p: string, _d: string) => {}) {
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
        typeof input === "string" ? Readable.from([Buffer.from(input)]) : Array.isArray(input) ? Readable.from(input) : input,
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
  const split = bytes.indexOf(0xc3) + 1; // between the two bytes of "ä"
  assert.equal(bytes[split], 0xa4);
  const f = fakes([bytes.subarray(0, split), bytes.subarray(split)]);
  assert.equal(await f.run([]), 0);
  assert.equal(f.out, "https://example.org/ä\n");
  assert.ok(f.written["links.html"].includes('<a href="https://example.org/ä">'));
});

test("a failing stdin gives non-zero and one stderr line naming stdin", async () => {
  const failing = (async function* (): AsyncGenerator<Buffer> { throw new Error("boom\nline two"); })();
  const f = fakes(failing);
  assert.notEqual(await f.run([]), 0);
  assert.equal(f.err.trimEnd().split("\n").length, 1);
  assert.ok(f.err.includes("cannot read stdin: boom line two"));
  assert.equal(f.out, "");
  assert.deepEqual(Object.keys(f.written), []);
});

test("control characters in an error message do not reach stderr", async () => {
  const f = fakes("a\n", async () => { throw new Error("bad\u001b]0;title\u0007path" + String.fromCharCode(0x2028) + "x"); });
  assert.notEqual(await f.run([]), 0);
  assert.ok(!/[\p{Cc}\p{Zl}\p{Zp}]/u.test(f.err.trimEnd()));
  assert.ok(f.err.includes("path"));
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
