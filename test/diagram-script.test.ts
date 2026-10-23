import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/diagram.sh", import.meta.url));
const docs = fileURLToPath(new URL("../docs", import.meta.url));
const TIMEOUT_MS = 20000;
const KILL_WAIT_MS = 2000; // after the kill; a process that still holds its pipes then is left to the OS
const SYSTEM_PATH = "/usr/bin:/bin";

type Result = { code: number | null; stdout: string; stderr: string };

// Runs the script as a process with `sh` by absolute path, so a PATH without sh still works.
async function run(scriptPath: string, args: string[], env: NodeJS.ProcessEnv): Promise<Result> {
  // detached: the script gets its own process group, so a timeout can end it and mmdc with it.
  const child = spawn("/bin/sh", [scriptPath, ...args], { env, stdio: ["ignore", "pipe", "pipe"], detached: true });
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
    // Always the whole group: a grandchild (a stub mmdc) can outlive the shell and hold the pipes open.
    try {
      process.kill(-(child.pid as number), "SIGKILL");
    } catch {
      // no group to kill (already gone, or never spawned): fall back to the child itself
      child.kill("SIGKILL");
    }
    await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, KILL_WAIT_MS).unref())]);
  }
}

// A temp directory with the script and a copy of docs/ at the same relative places, and an empty stub directory.
async function withSandbox(body: (dir: string, stubs: string, svg: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "diagram-script-"));
  try {
    await mkdir(join(dir, "scripts"));
    await cp(script, join(dir, "scripts", "diagram.sh"));
    await cp(docs, join(dir, "docs"), { recursive: true });
    const stubs = join(dir, "stubs");
    await mkdir(stubs);
    await body(dir, stubs, join(dir, "docs", "links.svg"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function stubMmdc(stubs: string, body: string): Promise<void> {
  const file = join(stubs, "mmdc");
  await writeFile(file, `#!/bin/sh\n${body}\n`);
  await chmod(file, 0o755);
}

// The stub logs "<input> <output>" to $STUB_LOG, fails if the input is not an existing file, writes to the file after
// `-o` as mmdc does, and like mmdc refuses an output name not ending in .svg.
const writeStub = `while [ $# -gt 0 ]; do
  [ "$1" = "-i" ] && in="$2"
  [ "$1" = "-o" ] && out="$2"
  shift
done
[ -f "$in" ] || { echo "input is not a file: $in" >&2; exit 5; }
case "$out" in *.svg) ;; *) echo "output must end in .svg" >&2; exit 4 ;; esac
printf '%s\\n%s\\n' "$in" "$out" >> "$STUB_LOG"
printf 'stub svg' > "$out"`;

function envWith(stubs: string, log: string, path = `${stubs}:${SYSTEM_PATH}`): NodeJS.ProcessEnv {
  return { ...process.env, PATH: path, STUB_LOG: log };
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The script keeps its temp directory next to the target and removes it again.
async function leftovers(dir: string): Promise<string[]> {
  return (await readdir(join(dir, "docs"))).filter((name) => name.startsWith(".diagram."));
}

test("a PATH without mmdc: exit 1 and stderr begins with the install message", async () => {
  await withSandbox(async (dir, stubs, svg) => {
    const before = await readFile(svg);
    const r = await run(join(dir, "scripts", "diagram.sh"), [], envWith(stubs, join(dir, "log"), stubs));
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /^error: mmdc is not installed/);
    assert.equal(r.stdout, "");
    assert.ok(before.equals(await readFile(svg)), "docs/links.svg changed");
  });
});

test("any argument: exit 2, the usage line, mmdc is not run", async () => {
  await withSandbox(async (dir, stubs, svg) => {
    await stubMmdc(stubs, writeStub);
    const before = await readFile(svg);
    for (const args of [["extra"], ["a", "b"], [""]]) {
      const r = await run(join(dir, "scripts", "diagram.sh"), args, envWith(stubs, join(dir, "log")));
      assert.equal(r.code, 2, r.stderr);
      assert.match(r.stderr, /^usage: npm run diagram$/m);
      assert.equal(r.stdout, "");
    }
    assert.ok(before.equals(await readFile(svg)), "docs/links.svg changed");
    await assert.rejects(readFile(join(dir, "log")), { code: "ENOENT" });
  });
});

test("a stub mmdc that writes a file and exits 0: exit 0 and docs/links.svg holds its output", async () => {
  await withSandbox(async (dir, stubs, svg) => {
    await stubMmdc(stubs, writeStub);
    const log = join(dir, "log");
    const r = await run(join(dir, "scripts", "diagram.sh"), [], envWith(stubs, log));
    assert.equal(r.code, 0, r.stderr);
    assert.equal(await readFile(svg, "utf8"), "stub svg");
    assert.equal(r.stdout, "");
    const [input, output] = (await readFile(log, "utf8")).trim().split("\n");
    assert.equal(input, `${dir}/scripts/../docs/links.mmd`);
    assert.match(output, new RegExp(`^${escapeRegExp(`${dir}/scripts/../docs`)}/\\.diagram\\.[^/]+/links\\.svg$`));
    assert.deepEqual(await leftovers(dir), []);
  });
});

test("a stub mmdc that exits non-zero after writing: exit 1 and the existing docs/links.svg is unchanged", async () => {
  await withSandbox(async (dir, stubs, svg) => {
    const before = Buffer.from([0x3c, 0x73, 0x76, 0x67, 0x3e, 0x00, 0xff, 0x0a]);
    await writeFile(svg, before);
    await stubMmdc(stubs, `${writeStub}\nexit 3`);
    const log = join(dir, "log");
    const r = await run(join(dir, "scripts", "diagram.sh"), [], envWith(stubs, log));
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /^error: mmdc failed rendering docs\/links\.mmd$/m);
    const [, output] = (await readFile(log, "utf8")).trim().split("\n");
    assert.match(output, new RegExp(`^${escapeRegExp(`${dir}/scripts/../docs`)}/\\.diagram\\.[^/]+/links\\.svg$`));
    assert.ok(before.equals(await readFile(svg)), "docs/links.svg changed");
    assert.deepEqual(await leftovers(dir), []);
  });
});

test("a stub mmdc that exits 0 and writes nothing: exit 1 and the existing docs/links.svg is unchanged", async () => {
  await withSandbox(async (dir, stubs, svg) => {
    const before = await readFile(svg);
    await stubMmdc(stubs, `: > /dev/null`);
    const r = await run(join(dir, "scripts", "diagram.sh"), [], envWith(stubs, join(dir, "log")));
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /^error: mmdc wrote no output for docs\/links\.mmd$/m);
    assert.ok(before.equals(await readFile(svg)), "docs/links.svg changed");
    assert.deepEqual(await leftovers(dir), []);
  });
});

test("a stub mmdc that exits 0 and writes an empty file: exit 1 and the existing docs/links.svg is unchanged", async () => {
  await withSandbox(async (dir, stubs, svg) => {
    const before = await readFile(svg);
    await stubMmdc(stubs, `while [ $# -gt 0 ]; do [ "$1" = "-o" ] && : > "$2"; shift; done`);
    const r = await run(join(dir, "scripts", "diagram.sh"), [], envWith(stubs, join(dir, "log")));
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /^error: mmdc wrote no output for docs\/links\.mmd$/m);
    assert.ok(before.equals(await readFile(svg)), "docs/links.svg changed");
    assert.deepEqual(await leftovers(dir), []);
  });
});

test("a missing docs/links.mmd: exit 1 and the missing-source message", async () => {
  await withSandbox(async (dir, stubs) => {
    await stubMmdc(stubs, writeStub);
    await rm(join(dir, "docs", "links.mmd"));
    const svg = join(dir, "docs", "links.svg");
    const before = await readFile(svg);
    const r = await run(join(dir, "scripts", "diagram.sh"), [], envWith(stubs, join(dir, "log")));
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /^error: docs\/links\.mmd is missing$/m);
    assert.equal(r.stdout, "");
    assert.ok(before.equals(await readFile(svg)), "docs/links.svg changed");
    await assert.rejects(readFile(join(dir, "log")), { code: "ENOENT" });
    assert.deepEqual(await leftovers(dir), []);
  });
});

test("docs/links.svg is a directory: exit 1 and the message, mmdc is not run", async () => {
  await withSandbox(async (dir, stubs, svg) => {
    await stubMmdc(stubs, writeStub);
    await rm(svg);
    await mkdir(svg);
    const r = await run(join(dir, "scripts", "diagram.sh"), [], envWith(stubs, join(dir, "log")));
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /^error: docs\/links\.svg is a directory$/m);
    assert.equal(r.stdout, "");
    assert.ok((await stat(svg)).isDirectory(), "docs/links.svg is no longer a directory");
    await assert.rejects(readFile(join(dir, "log")), { code: "ENOENT" });
    assert.deepEqual(await leftovers(dir), []);
  });
});
