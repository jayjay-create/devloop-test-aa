import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bin = new URL("../src/bin.ts", import.meta.url).pathname;

test("a reader that closes stdout early does not crash the program or lose the page", async () => {
  const dir = await mkdtemp(join(tmpdir(), "links-"));
  const page = join(dir, "out.html");
  const child = spawn(process.execPath, [bin, page], { stdio: ["pipe", "pipe", "pipe"] });
  let err = "";
  child.stderr.on("data", (d) => (err += d));
  child.stdout.once("data", () => child.stdout.destroy()); // like `| head -1`
  const links = Array.from({ length: 50000 }, (_, i) => `https://example.org/${i}\n`).join("");
  child.stdin.on("error", () => {});
  child.stdin.end(links);
  const code = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(err, "");
  assert.equal(code, 0);
  assert.ok((await readFile(page, "utf8")).includes('<a href="https://example.org/49999">'));
});
