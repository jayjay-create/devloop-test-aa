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
    get out() {
      return out;
    },
    get err() {
      return err;
    },
    run: (argv: string[]) =>
      main(
        argv,
        typeof input === "string"
          ? Readable.from([Buffer.from(input)])
          : Array.isArray(input)
            ? Readable.from(input)
            : input,
        {
          write: (s: string) => {
            out += s;
            return true;
          },
        },
        async (p: string, d: string) => {
          await writeFile(p, d);
          written[p] = d;
        },
        {
          write: (s: string) => {
            err += s;
            return true;
          },
        },
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
  const failing: AsyncIterable<Buffer> = {
    [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error("boom\nline two")) }),
  };
  const f = fakes(failing);
  assert.notEqual(await f.run([]), 0);
  assert.equal(f.err.trimEnd().split("\n").length, 1);
  assert.ok(f.err.includes("cannot read stdin: boom line two"));
  assert.equal(f.out, "");
  assert.deepEqual(Object.keys(f.written), []);
});

test("control characters in an error message do not reach stderr", async () => {
  const f = fakes("a\n", async () => {
    throw new Error(`bad\u001b]0;title\u0007path${String.fromCharCode(0x2028)}x`);
  });
  assert.notEqual(await f.run([]), 0);
  assert.ok(!/[\p{Cc}\p{Zl}\p{Zp}]/u.test(f.err.trimEnd()));
  assert.equal(f.err, "error: cannot write links.html: bad ]0;title path x\n");
});

test("control characters in the output path do not reach stderr", async () => {
  const f = fakes("a\n", async () => {
    throw new Error("denied");
  });
  assert.notEqual(await f.run(["dir\u001b[31m/out.html"]), 0);
  assert.ok(!/[\p{Cc}\p{Zl}\p{Zp}]/u.test(f.err.trimEnd()));
  assert.ok(f.err.includes("out.html"));
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
  const f = fakes("a\n", async () => {
    throw new Error("disk full");
  });
  assert.notEqual(await f.run(["x/out.html"]), 0);
  assert.equal(f.err.trimEnd().split("\n").length, 1);
  assert.ok(f.err.includes("x/out.html") && f.err.includes("disk full"));
  assert.equal(f.out, "a\n");
});

function liHrefs(page: string): string[] {
  return [...page.matchAll(/<li><a href="([^"]*)">/g)].map((m) => m[1]);
}

test("--sort prints and writes the distinct links in code-unit order", async () => {
  const f = fakes("b\na\nb\nB\n");
  assert.equal(await f.run(["--sort"]), 0);
  assert.equal(f.out, "B\na\nb\n");
  assert.deepEqual(liHrefs(f.written["links.html"]), ["B", "a", "b"]);
});

test("without --sort the links stay in input order", async () => {
  const f = fakes("b\na\nb\nB\n");
  assert.equal(await f.run([]), 0);
  assert.equal(f.out, "b\na\nB\n");
  assert.deepEqual(liHrefs(f.written["links.html"]), ["b", "a", "B"]);
});

test("--sort before, after and twice gives the same result and page name, and a second page name is ignored", async () => {
  for (const argv of [
    ["--sort", "out.html"],
    ["out.html", "--sort"],
    ["--sort", "out.html", "--sort"],
  ]) {
    const f = fakes("b\na\nB\n");
    assert.equal(await f.run(argv), 0, argv.join(" "));
    assert.equal(f.out, "B\na\nb\n", argv.join(" "));
    assert.deepEqual(Object.keys(f.written), ["out.html"], argv.join(" "));
    assert.deepEqual(liHrefs(f.written["out.html"]), ["B", "a", "b"], argv.join(" "));
  }
  const g = fakes("b\na\n");
  assert.equal(await g.run(["x.html", "--sort", "ignored.html"]), 0);
  assert.deepEqual(Object.keys(g.written), ["x.html"]);
  assert.equal(g.out, "a\nb\n");
});

test("--sort without a page name writes links.html", async () => {
  const f = fakes("b\na\n");
  assert.equal(await f.run(["--sort"]), 0);
  assert.deepEqual(Object.keys(f.written), ["links.html"]);
});

test("an unknown option returns 2 with one stderr line and writes nothing", async () => {
  let read = false;
  const input: AsyncIterable<Buffer> = {
    [Symbol.asyncIterator]: () => {
      read = true;
      return { next: () => Promise.resolve({ done: true, value: undefined }) };
    },
  };
  const f = fakes(input);
  assert.equal(await f.run(["--foo"]), 2);
  assert.equal(f.err, "error: unknown option: --foo (only --sort, --count and --exclude=GLOB are supported)\n");
  assert.equal(f.out, "");
  assert.deepEqual(Object.keys(f.written), []);
  assert.equal(read, false);
});

test("an unknown option after --sort and a page name is still rejected", async () => {
  const f = fakes("a\n");
  assert.equal(await f.run(["--sort", "out.html", "--sotr"]), 2);
  assert.ok(f.err.includes("--sotr"));
  assert.equal(f.out, "");
  assert.deepEqual(Object.keys(f.written), []);
});

test("control characters in an unknown option do not reach stderr", async () => {
  const f = fakes("a\n");
  assert.equal(await f.run([`--x\n\u001b[31m`]), 2);
  assert.equal(f.err, "error: unknown option: --x [31m (only --sort, --count and --exclude=GLOB are supported)\n");
  assert.equal(f.err.trimEnd().split("\n").length, 1);
  assert.ok(!/[\p{Cc}\p{Zl}\p{Zp}]/u.test(f.err.trimEnd()));
  assert.equal(f.out, "");
  assert.deepEqual(Object.keys(f.written), []);
});

test("empty input with --sort writes the empty page and prints nothing", async () => {
  const f = fakes("");
  assert.equal(await f.run(["--sort"]), 0);
  assert.equal(f.out, "");
  assert.ok(f.written["links.html"].includes("<ul></ul>"));
});

test("--count with three distinct links prints exactly the number and no link", async () => {
  const f = fakes("https://example.org/a\n/b\nc\n");
  assert.equal(await f.run(["--count"]), 0);
  assert.equal(f.out, "3\n");
});

test("--count counts a link that appears twice once", async () => {
  const f = fakes("a\nb\na\n");
  assert.equal(await f.run(["--count"]), 0);
  assert.equal(f.out, "2\n");
});

test("--count with no input prints 0", async () => {
  const f = fakes("");
  assert.equal(await f.run(["--count"]), 0);
  assert.equal(f.out, "0\n");
});

test("--count with --sort prints the same number as --count", async () => {
  const input = "b\na\nb\nB\n";
  const plain = fakes(input);
  await plain.run(["--count"]);
  const sorted = fakes(input);
  assert.equal(await sorted.run(["--count", "--sort"]), 0);
  assert.equal(sorted.out, "3\n");
  assert.equal(sorted.out, plain.out);
});

test("with --count the page is still written, to the named target and to links.html by default", async () => {
  const named = fakes("a\nb\n");
  assert.equal(await named.run(["--count", "out.html"]), 0);
  assert.deepEqual(Object.keys(named.written), ["out.html"]);
  assert.equal(named.written["out.html"].match(/<li>/g)?.length, 2);
  const def = fakes("a\nb\n");
  assert.equal(await def.run(["--count"]), 0);
  assert.deepEqual(Object.keys(def.written), ["links.html"]);
  assert.equal(def.written["links.html"].match(/<li>/g)?.length, 2);
});

test("--count prints the number alone and the page equals the page written without --count", async () => {
  const input = "a\nb\na\n";
  const counted = fakes(input);
  assert.equal(await counted.run(["--count"]), 0);
  assert.equal(counted.out, "2\n");
  const plain = fakes(input);
  assert.equal(await plain.run([]), 0);
  assert.ok(counted.written["links.html"], "page written with --count");
  assert.equal(counted.written["links.html"], plain.written["links.html"]);
});

test("--count with exactly one link prints 1", async () => {
  const f = fakes("only\n");
  assert.equal(await f.run(["--count"]), 0);
  assert.equal(f.out, "1\n");
});

test("--count after --sort or after the page name works the same", async () => {
  for (const [argv, plainArgv, key] of [
    [["--sort", "--count"], ["--sort"], "links.html"],
    [["out.html", "--count"], ["out.html"], "out.html"],
    [["--sort", "out.html", "--count"], ["--sort", "out.html"], "out.html"],
  ] as const) {
    const f = fakes("b\na\nb\n");
    assert.equal(await f.run([...argv]), 0, argv.join(" "));
    assert.equal(f.out, "2\n", argv.join(" "));
    assert.deepEqual(Object.keys(f.written), [key], argv.join(" "));
    const plain = fakes("b\na\nb\n");
    assert.equal(await plain.run([...plainArgv]), 0, plainArgv.join(" "));
    assert.ok(f.written[key], argv.join(" "));
    assert.equal(f.written[key], plain.written[key], argv.join(" "));
  }
});

test("--exclude=GLOB drops matching links from console and page, keeping the order", async () => {
  const f = fakes("a.pdf\nb\nc.PDF\nd.pdf\ne\n");
  assert.equal(await f.run(["--exclude=*.pdf"]), 0);
  assert.equal(f.out, "b\nc.PDF\ne\n");
  const page = f.written["links.html"];
  assert.equal(page.match(/<li>/g)?.length, 3);
  assert.ok(!page.includes("a.pdf") && !page.includes("d.pdf"));
});

test("--exclude is repeatable: a link matching any one pattern is dropped", async () => {
  const f = fakes("a.pdf\nb.zip\nc.html\n");
  assert.equal(await f.run(["--exclude=*.pdf", "--exclude=*.zip"]), 0);
  assert.equal(f.out, "c.html\n");
});

test("--exclude with --count counts only the remaining distinct links", async () => {
  const f = fakes("a.pdf\nb\nb\nc\na.pdf\n");
  assert.equal(await f.run(["--count", "--exclude=*.pdf"]), 0);
  assert.equal(f.out, "2\n");
  assert.equal(f.written["links.html"].match(/<li>/g)?.length, 2);
});

test("--exclude and --sort: the remaining links are sorted", async () => {
  const f = fakes("d\nx.pdf\nb\nc\n");
  assert.equal(await f.run(["--sort", "--exclude=*.pdf"]), 0);
  assert.equal(f.out, "b\nc\nd\n");
});

test("--exclude=* leaves nothing: no console text, --count prints 0, the page holds an empty list", async () => {
  const f = fakes("a\nb\n");
  assert.equal(await f.run(["--exclude=*"]), 0);
  assert.equal(f.out, "");
  assert.ok(f.written["links.html"].includes("<ul></ul>"));
  const g = fakes("a\nb\n");
  assert.equal(await g.run(["--count", "--exclude=*"]), 0);
  assert.equal(g.out, "0\n");
  assert.ok(g.written["links.html"].includes("<ul></ul>"));
});

test("a bare --exclude exits 2 as an unknown option and writes nothing", async () => {
  const f = fakes("a\n");
  assert.equal(await f.run(["--exclude"]), 2);
  assert.equal(f.err, "error: unknown option: --exclude (only --sort, --count and --exclude=GLOB are supported)\n");
  assert.equal(f.out, "");
  assert.deepEqual(Object.keys(f.written), []);
});

test("--exclude= with an empty glob excludes only an empty text, so every link stays", async () => {
  const f = fakes("a\nb\n");
  assert.equal(await f.run(["--exclude="]), 0);
  assert.equal(f.out, "a\nb\n");
});

// The hrefs of the page's list items, in order, with the five entities escapeHtml writes decoded.
function pageHrefs(html: string): string[] {
  return [...html.matchAll(/<li><a href="([^"]*)">/g)].map((m) =>
    m[1]
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'")
      .replaceAll("&amp;", "&"),
  );
}

test("a duplicate of an excluded link is gone too, and a remaining duplicate counts once", async () => {
  const f = fakes("a\nb\nb\na\n");
  assert.equal(await f.run(["--exclude=a"]), 0);
  assert.equal(f.out, "b\n");
  assert.deepEqual(pageHrefs(f.written["links.html"]), ["b"]);
  const g = fakes("a\nb\nb\na\n");
  assert.equal(await g.run(["--count", "--exclude=a"]), 0);
  assert.equal(g.out, "1\n");
});

test("the page hrefs of the remaining links are decoded: a link with & stays as typed", async () => {
  const f = fakes("a\nx?a=1&b=2\na\n");
  assert.equal(await f.run(["--exclude=a"]), 0);
  assert.equal(f.out, "x?a=1&b=2\n");
  assert.ok(f.written["links.html"].includes("x?a=1&amp;b=2"));
  assert.deepEqual(pageHrefs(f.written["links.html"]), ["x?a=1&b=2"]);
});

test("pageHrefs decodes every entity once: a link that contains &lt; stays as typed", async () => {
  const link = "x?q=&lt;&\"'<>";
  const f = fakes(`a\n${link}\n`);
  assert.equal(await f.run(["--exclude=a"]), 0);
  assert.ok(f.written["links.html"].includes("x?q=&amp;lt;&amp;&quot;&#39;&lt;&gt;"));
  assert.deepEqual(pageHrefs(f.written["links.html"]), [link]);
});
