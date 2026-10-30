import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseLinks,
  distinct,
  escapeHtml,
  renderPage,
  consoleText,
  matchesGlob,
  applyExclude,
  parseLimit,
  applyLimit,
} from "../src/core.ts";

test("distinct keeps the first occurrence in order", () => {
  assert.deepEqual(distinct(["b", "a", "b"]), ["b", "a"]);
});

test("parseLinks strips trailing CR, drops empty lines, does not trim inside a line", () => {
  assert.deepEqual(parseLinks("a\r\n\nb\n"), ["a", "b"]);
  assert.deepEqual(parseLinks(" a b \n"), [" a b "]);
});

test("parseLinks drops a line that is only CR and keeps a CR inside a line", () => {
  assert.deepEqual(parseLinks("a\r\n\r\nb\r\n"), ["a", "b"]);
  assert.deepEqual(parseLinks("a\rb\n"), ["a\rb"]);
});

test("a relative link passes through unchanged", () => {
  const out = distinct(parseLinks("../x.html\n"));
  assert.deepEqual(out, ["../x.html"]);
  assert.ok(renderPage(out).includes('<a href="../x.html">../x.html</a>'));
});

test("renderPage([]) is a complete document with an empty ul and no li", () => {
  const page = renderPage([]);
  assert.match(page, /^<!doctype html>/i);
  assert.ok(page.includes("<html") && page.includes("</html>"));
  assert.ok(page.includes("<ul></ul>"));
  assert.ok(!page.includes("<li>"));
});

test("renderPage escapes href and text", () => {
  const page = renderPage(['a&b"<c']);
  assert.ok(page.includes('href="a&amp;b&quot;&lt;c"'));
  assert.ok(page.includes(">a&amp;b&quot;&lt;c</a>"));
  assert.ok(!page.includes("<c"));
});

test("escapeHtml escapes & < > \" '", () => {
  assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
});

test("consoleText([]) is the empty string, otherwise newline-joined", () => {
  assert.equal(consoleText([]), "");
  assert.equal(consoleText(["a", "b"]), "a\nb");
});

test("matchesGlob: * matches any text, case-sensitive: *.pdf matches a/b.pdf and not a/b.PDF", () => {
  assert.equal(matchesGlob("*.pdf", "a/b.pdf"), true);
  assert.equal(matchesGlob("*.pdf", "a/b.PDF"), false);
});

test("matchesGlob matches the whole href, not a part of it", () => {
  assert.equal(matchesGlob("*.pdf", "a.pdf.html"), false);
  assert.equal(matchesGlob("b.pdf", "a/b.pdf"), false);
  assert.equal(matchesGlob("a/*", "xa/b"), false);
});

test("matchesGlob: regex metacharacters are literal", () => {
  assert.equal(matchesGlob("a.b", "axb"), false);
  assert.equal(matchesGlob("a.b", "a.b"), true);
  assert.equal(matchesGlob("a+b(c)[d]{e}|f^$\\", "a+b(c)[d]{e}|f^$\\"), true);
  assert.equal(matchesGlob("a+", "aa"), false);
});

test("matchesGlob: a hyphen, a slash and non-ASCII text are literal", () => {
  assert.equal(matchesGlob("a-b/c*\u00e4", "a-b/cxx\u00e4"), true);
  assert.equal(matchesGlob("a-b", "a-c"), false);
});

test("matchesGlob: ? and [ are literal", () => {
  assert.equal(matchesGlob("a?", "a?"), true);
  assert.equal(matchesGlob("a?", "ab"), false);
  assert.equal(matchesGlob("[ab]", "a"), false);
  assert.equal(matchesGlob("[ab]", "[ab]"), true);
});

test("matchesGlob: a pattern without * matches only the identical text", () => {
  assert.equal(matchesGlob("https://a.org/x", "https://a.org/x"), true);
  assert.equal(matchesGlob("https://a.org/x", "https://a.org/x/"), false);
});

test("matchesGlob: * alone matches every link, including the empty text and newlines", () => {
  assert.equal(matchesGlob("*", "anything/at?all"), true);
  assert.equal(matchesGlob("*", ""), true);
  assert.equal(matchesGlob("a*b", "a\nb"), true);
  assert.equal(matchesGlob("**", "x"), true);
});

test("applyExclude keeps the order of the remaining links", () => {
  assert.deepEqual(applyExclude(["c", "a.pdf", "b", "d.pdf", "a"], ["*.pdf"]), ["c", "b", "a"]);
});

test("applyExclude removes a link that matches any one of several patterns", () => {
  assert.deepEqual(applyExclude(["x.pdf", "y.zip", "z.html"], ["*.pdf", "*.zip"]), ["z.html"]);
});

test("applyExclude with no patterns returns the list unchanged", () => {
  assert.deepEqual(applyExclude(["a", "b"], []), ["a", "b"]);
});

test("matchesGlob: many * against a long non-matching text finishes quickly (no exponential backtracking)", () => {
  const started = performance.now();
  assert.equal(matchesGlob("*a*a*a*a*a*b", "a".repeat(5000)), false);
  const ms = performance.now() - started;
  assert.ok(ms < 1000, `took ${String(ms)} ms`);
});

test("matchesGlob: backtracking and edge cases", () => {
  const cases: [string, string, boolean][] = [
    ["*ab", "aab", true],
    ["*ab*", "aab", true],
    ["a*b*c", "abcbc", true],
    ["a*b*c", "abxc", true], // the second * takes "x"
    ["a*b*c", "abxd", false],
    ["a*b*c", "acb", false],
    ["*a*b", "ab ab", true],
    ["a*", "a", true],
    ["**", "", true],
    ["", "", true],
    ["", "a", false],
    ["abc", "ab", false],
    ["ab*c", "ab", false],
    ["*a*a*b", "aaab", true],
  ];
  for (const [pattern, href, expected] of cases) {
    assert.equal(matchesGlob(pattern, href), expected, `${JSON.stringify(pattern)} vs ${JSON.stringify(href)}`);
  }
});

test("renderPage with a title writes an escaped h1 before the ul", () => {
  const page = renderPage(["a"], { title: 'A <b> & "c"' });
  const h1 = "<h1>A &lt;b&gt; &amp; &quot;c&quot;</h1>";
  assert.ok(page.includes(h1), page);
  assert.ok(page.indexOf(h1) < page.indexOf("<ul>"), page);
  assert.ok(page.includes("<title>Links</title>"));
  const empty = renderPage([], { title: "T" });
  assert.ok(empty.includes("<h1>T</h1>"), empty);
  assert.ok(empty.indexOf("<h1>T</h1>") < empty.indexOf("<ul></ul>"), empty);
});

test("renderPage without a title, with an empty one or with undefined is byte-identical", () => {
  const links = ["a", "b&c"];
  assert.equal(renderPage(links, { title: "" }), renderPage(links));
  assert.equal(renderPage(links, {}), renderPage(links));
  assert.equal(renderPage(links, { title: undefined }), renderPage(links));
  assert.ok(!renderPage(links, { title: "" }).includes("<h1>"));
});

test("parseLimit accepts a whole number of at least 1 that is a safe integer", () => {
  const cases: [string, number][] = [
    ["1", 1],
    ["3", 3],
    ["100", 100],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
  ];
  for (const [text, expected] of cases) assert.equal(parseLimit(text), expected, text);
});

test("parseLimit refuses everything else", () => {
  const texts = [
    "",
    "0",
    "-1",
    "abc",
    "2.5",
    "1e3",
    "0x10",
    "007",
    "+3",
    String(Number.MAX_SAFE_INTEGER + 2),
    " 3",
    "3 ",
    "3\n",
  ];
  for (const text of texts) assert.equal(parseLimit(text), undefined, JSON.stringify(text));
});

test("applyLimit: undefined and a limit above the length leave the input, otherwise the first N in order", () => {
  const links = ["c", "a", "b"];
  assert.deepEqual(applyLimit(links, undefined), ["c", "a", "b"]);
  assert.deepEqual(applyLimit(links, 4), ["c", "a", "b"]);
  assert.deepEqual(applyLimit(links, 3), ["c", "a", "b"]);
  assert.deepEqual(applyLimit(links, 2), ["c", "a"]);
  assert.deepEqual(applyLimit(links, 1), ["c"]);
  assert.deepEqual(applyLimit([], 2), []);
});
