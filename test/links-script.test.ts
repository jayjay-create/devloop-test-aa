import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { chmod, copyFile, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/links.sh", import.meta.url));
const sample = fileURLToPath(new URL("./sample.html", import.meta.url));
const TIMEOUT_MS = 20000;

// The distinct `a` links of sample.html in document order; the <link> and <img> hrefs are not among them.
const expectedLinks = ["https://example.org/a", "/relative/page", "https://example.org/b?x=1&y=2"];

function onPath(name: string): boolean {
  return (process.env.PATH ?? "").split(delimiter).some((dir) => {
    try {
      accessSync(join(dir, name), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}
const skipNoHtmlq = onPath("htmlq") ? false : "htmlq is not on the PATH (brew install htmlq)";

type Result = { code: number | null; stdout: string; stderr: string };

// Runs the script as a process with `sh` by absolute path, so a PATH without sh still works.
async function run(args: string[], env: NodeJS.ProcessEnv = process.env, cwd?: string): Promise<Result> {
  // detached: the script gets its own process group, so a timeout can end node and htmlq with it.
  const child = spawn("/bin/sh", [script, ...args], { env, cwd, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const closed = new Promise<number | null>((resolve) => child.on("close", resolve));
  let timer: NodeJS.Timeout | undefined;
  try {
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d: string) => (stdout += d));
    child.stderr.on("data", (d: string) => (stderr += d));
    const code = await Promise.race([
      closed,
      new Promise<never>((_, reject) => {
        child.on("error", reject);
        timer = setTimeout(
          () => reject(new Error(`script still running after ${TIMEOUT_MS} ms; stderr: ${stderr}`)),
          TIMEOUT_MS,
        );
      }),
    ]);
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(-(child.pid as number), "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      await closed;
    }
  }
}

test("prints the distinct a links of the sample in document order and writes one a per link", {
  skip: skipNoHtmlq,
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), "links-script-"));
  try {
    const page = join(dir, "out.html");
    const r = await run([sample, page]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, `${expectedLinks.join("\n")}\n`);
    assert.ok(!r.stdout.includes("style.css") && !r.stdout.includes("pic.png"));
    const html = await readFile(page, "utf8");
    assert.equal(html.match(/<a /g)?.length, expectedLinks.length);
    for (const link of expectedLinks) assert.ok(html.includes(`<a href="${link.replaceAll("&", "&amp;")}">`), link);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("without an output path the page is links.html in the current directory", { skip: skipNoHtmlq }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "links-script-"));
  try {
    const r = await run([sample], process.env, dir);
    assert.equal(r.code, 0, r.stderr);
    const html = await readFile(join(dir, "links.html"), "utf8");
    assert.equal(html.match(/<a /g)?.length, expectedLinks.length);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an HTML file path with spaces works", { skip: skipNoHtmlq }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "links-script-"));
  try {
    const input = join(dir, "my page.html");
    await symlink(sample, input);
    const page = join(dir, "out page.html");
    const r = await run([input, page]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, `${expectedLinks.join("\n")}\n`);
    assert.equal((await readFile(page, "utf8")).match(/<a /g)?.length, expectedLinks.length);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("no arguments: usage line on stderr and exit code 2", async () => {
  const r = await run([]);
  assert.equal(r.code, 2, r.stderr);
  assert.match(r.stderr, /^usage: /m);
  assert.equal(r.stdout, "");
});

test("htmlq missing from the PATH: exit non-zero and the message names htmlq", async () => {
  const dir = await mkdtemp(join(tmpdir(), "links-script-"));
  try {
    await symlink(process.execPath, join(dir, "node"));
    const r = await run([sample, join(dir, "out.html")], { ...process.env, PATH: dir });
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /htmlq/);
    assert.match(r.stderr, /install/);
    assert.equal(r.stdout, "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a missing input file fails with exit code 1 and writes no page", { skip: skipNoHtmlq }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "links-script-"));
  try {
    const page = join(dir, "out.html");
    const r = await run([join(dir, "missing.html"), page]);
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /missing\.html/);
    assert.equal(r.stdout, "");
    await assert.rejects(readFile(page, "utf8"), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Not for root: root reads files whatever their mode.
const skipRoot = process.getuid?.() === 0 ? "running as root" : skipNoHtmlq;
test("an input file without read permission fails with exit code 1 and writes no page", {
  skip: skipRoot,
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), "links-script-"));
  try {
    const input = join(dir, "locked.html");
    await copyFile(sample, input);
    await chmod(input, 0o000);
    const page = join(dir, "out.html");
    const r = await run([input, page]);
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /locked\.html/);
    assert.equal(r.stdout, "");
    await assert.rejects(readFile(page, "utf8"), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("control characters in the input file name do not reach stderr", { skip: skipNoHtmlq }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "links-script-"));
  try {
    const r = await run([join(dir, "bad\u001b[31mname.html")]);
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /cannot read HTML file: .*bad\[31mname\.html$/m);
    assert.ok(!/[\p{Cc}]/u.test(r.stderr.trimEnd()));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a file name made only of control characters is reported without them", { skip: skipNoHtmlq }, async () => {
  for (const name of ["\u001b", "\n\r"]) {
    const r = await run([name]);
    assert.equal(r.code, 1, r.stderr);
    assert.equal(r.stderr, "error: cannot read HTML file: (name without printable characters)\n");
  }
});
