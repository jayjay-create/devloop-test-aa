import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLinks, distinct, escapeHtml, renderPage, consoleText } from "../src/core.ts";

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
