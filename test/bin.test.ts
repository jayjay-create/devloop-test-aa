import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const bin = fileURLToPath(new URL("../src/bin.ts", import.meta.url));

// Enough output (about 1.4 MB) that the program is still writing to stdout when the reader closes.
const LINK_COUNT = 50000;
const TIMEOUT_MS = 20000;

test("a reader that closes stdout early does not crash the program or lose the page", async () => {
  const dir = await mkdtemp(join(tmpdir(), "links-"));
  const page = join(dir, "out.html");
  // The program is started the way a user starts it: Node strips the TypeScript types itself.
  const child = spawn(process.execPath, [bin, page], { stdio: ["pipe", "pipe", "pipe"] });
  try {
    let err = "";
    child.stderr.on("data", (d: Buffer) => (err += d));
    child.stdout.once("data", () => child.stdout.destroy()); // like `| head -1`
    // The program may exit before it has read all of stdin; that failure is not what this test is about.
    child.stdin.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code !== "EPIPE") throw e;
    });
    child.stdin.end(Array.from({ length: LINK_COUNT }, (_, i) => `https://example.org/${i}\n`).join(""));
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`program still running after ${TIMEOUT_MS} ms`)), TIMEOUT_MS);
      child.on("error", reject);
      child.on("close", (c) => (clearTimeout(timer), resolve(c)));
    });
    assert.equal(err, "");
    assert.equal(code, 0);
    assert.ok((await readFile(page, "utf8")).includes(`<a href="https://example.org/${LINK_COUNT - 1}">`));
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
