import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
function findOnPath(name: string): string {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    try {
      accessSync(join(dir, name), constants.X_OK);
      return join(dir, name);
    } catch {}
  }
  throw new Error(`${name} is not on the PATH`);
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

const sortedLinks = [...expectedLinks].sort();
const usageLine = "usage: npm run links -- [--sort] [--count] <html-file> [<output-page>]";

// The link texts of the page's <li>s in page order.
function pageLinks(html: string): string[] {
  return [...html.matchAll(/<li><a href="[^"]*">([^<]*)<\/a><\/li>/g)].map((m) => m[1].replaceAll("&amp;", "&"));
}

test("--sort before the file prints the links sorted and writes links.html in that order", {
  skip: skipNoHtmlq,
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), "links-script-"));
  try {
    const r = await run(["--sort", sample], process.env, dir);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, `${sortedLinks.join("\n")}\n`);
    assert.notDeepEqual(sortedLinks, expectedLinks);
    assert.deepEqual(pageLinks(await readFile(join(dir, "links.html"), "utf8")), sortedLinks);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--sort between or after the file names gives the same sorted output and page", {
  skip: skipNoHtmlq,
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), "links-script-"));
  try {
    for (const args of [
      [sample, "--sort", "page.html"],
      [sample, "page.html", "--sort"],
    ]) {
      const r = await run(args, process.env, dir);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stdout, `${sortedLinks.join("\n")}\n`);
      assert.deepEqual(pageLinks(await readFile(join(dir, "page.html"), "utf8")), sortedLinks);
      await rm(join(dir, "page.html"));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--count prints only the number and still writes the page", { skip: skipNoHtmlq }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "links-script-"));
  try {
    const r = await run(["--count", sample, "page.html"], process.env, dir);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, "3\n");
    assert.deepEqual(pageLinks(await readFile(join(dir, "page.html"), "utf8")), expectedLinks);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("without --sort console and page stay in document order", { skip: skipNoHtmlq }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "links-script-"));
  try {
    const r = await run([sample], process.env, dir);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, `${expectedLinks.join("\n")}\n`);
    assert.deepEqual(pageLinks(await readFile(join(dir, "links.html"), "utf8")), expectedLinks);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unknown option exits 2 with one stderr line naming it and writes no page", async () => {
  const dir = await mkdtemp(join(tmpdir(), "links-script-"));
  try {
    const r = await run(["--bogus", sample], process.env, dir);
    assert.equal(r.code, 2, r.stderr);
    assert.equal(r.stderr, "error: unknown option: --bogus (only --sort and --count are supported)\n");
    assert.equal(r.stdout, "");
    await assert.rejects(readFile(join(dir, "links.html"), "utf8"), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("control characters in an unknown option do not reach stderr", async () => {
  const r = await run([sample, "--bad\u001b[31m\nname"]);
  assert.equal(r.code, 2, r.stderr);
  assert.equal(r.stderr, "error: unknown option: --bad[31mname (only --sort and --count are supported)\n");
});

test("a backslash sequence in an unknown option is printed as typed, not expanded", async () => {
  const r = await run(["--\\033[2J", sample]);
  assert.equal(r.code, 2, r.stderr);
  assert.equal(r.stderr, "error: unknown option: --\\033[2J (only --sort and --count are supported)\n");
});

test("an unknown option after valid arguments or beside --sort is still rejected and writes no page", async () => {
  const dir = await mkdtemp(join(tmpdir(), "links-script-"));
  try {
    for (const args of [
      [sample, "--nope"],
      ["--sort", sample, "page.html", "--nope"],
    ]) {
      const r = await run(args, process.env, dir);
      assert.equal(r.code, 2, r.stderr);
      assert.equal(r.stderr, "error: unknown option: --nope (only --sort and --count are supported)\n");
      assert.equal(r.stdout, "");
      await assert.rejects(readFile(join(dir, "page.html"), "utf8"), { code: "ENOENT" });
      await assert.rejects(readFile(join(dir, "links.html"), "utf8"), { code: "ENOENT" });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unknown option is rejected before htmlq is looked for", async () => {
  const dir = await mkdtemp(join(tmpdir(), "links-script-"));
  try {
    // printable needs tr; htmlq stays off this PATH.
    await symlink(process.execPath, join(dir, "node"));
    await symlink(findOnPath("tr"), join(dir, "tr"));
    const r = await run(["--bogus", sample], { ...process.env, PATH: dir }, dir);
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stderr, /--bogus/);
    assert.match(r.stderr, /\(only --sort and --count are supported\)/);
    assert.doesNotMatch(r.stderr, /htmlq/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--sort alone shows the usage line and exits 2", async () => {
  const r = await run(["--sort"]);
  assert.equal(r.code, 2, r.stderr);
  assert.equal(r.stderr, `${usageLine}\n`);
  assert.equal(r.stdout, "");
});

// A stub node in front of the PATH records the arguments it was called with, one per line.
// The first one is the script's bin.ts path; the rest are returned.
async function runWithStubNode(args: string[]): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), "links-script-"));
  try {
    const record = join(dir, "args.txt");
    const stub = join(dir, "bin", "node");
    await mkdir(join(dir, "bin"));
    await writeFile(stub, `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > "${record}"\ncat > /dev/null\n`);
    await chmod(stub, 0o755);
    const r = await run(
      args,
      { ...process.env, PATH: `${join(dir, "bin")}${delimiter}${process.env.PATH ?? ""}` },
      dir,
    );
    assert.equal(r.code, 0, r.stderr);
    const [bin, ...rest] = (await readFile(record, "utf8")).split("\n").slice(0, -1);
    assert.ok(bin?.endsWith("src/bin.ts"), `first node argument: ${bin}`);
    return rest;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("--count before or after the HTML file reaches node as an argument", { skip: skipNoHtmlq }, async () => {
  for (const args of [
    ["--count", sample],
    [sample, "--count"],
  ]) {
    assert.deepEqual(await runWithStubNode(args), ["--count"], args.join(" "));
  }
});

test("--count with an output page: node gets --count and the page", { skip: skipNoHtmlq }, async () => {
  for (const args of [
    ["--count", sample, "page.html"],
    [sample, "page.html", "--count"],
  ]) {
    assert.deepEqual(await runWithStubNode(args), ["--count", "page.html"], args.join(" "));
  }
});

test("--count together with --sort: both reach node", { skip: skipNoHtmlq }, async () => {
  for (const [args, expected] of [
    [
      ["--count", "--sort", sample],
      ["--sort", "--count"],
    ],
    [
      [sample, "--sort", "page.html", "--count"],
      ["--sort", "--count", "page.html"],
    ],
  ] as const) {
    assert.deepEqual(await runWithStubNode([...args]), expected, args.join(" "));
  }
});

test("without --count node does not get it", { skip: skipNoHtmlq }, async () => {
  assert.deepEqual(await runWithStubNode([sample]), [], "no options");
  assert.deepEqual(await runWithStubNode(["--sort", sample]), ["--sort"], "--sort only");
});
