import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/diagram.sh", import.meta.url));
const docs = fileURLToPath(new URL("../docs", import.meta.url));
const TIMEOUT_MS = 20000;
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

// The stub writes to the file after `-o`, as mmdc does, and like mmdc refuses an output name not ending in .svg.
const writeStub = `while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done
case "$out" in *.svg) ;; *) echo "output must end in .svg" >&2; exit 4 ;; esac
printf 'stub svg' > "$out"`;

test("a PATH without mmdc: exit 1 and stderr begins with the install message", async () => {
  await withSandbox(async (dir, stubs) => {
    const r = await run(join(dir, "scripts", "diagram.sh"), [], { ...process.env, PATH: stubs });
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /^error: mmdc is not installed/);
    assert.equal(r.stdout, "");
  });
});

test("any argument: exit 2 and the usage line", async () => {
  await withSandbox(async (dir, stubs) => {
    await stubMmdc(stubs, writeStub);
    const r = await run(join(dir, "scripts", "diagram.sh"), ["extra"], {
      ...process.env,
      PATH: `${stubs}:${SYSTEM_PATH}`,
    });
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stderr, /^usage: npm run diagram$/m);
  });
});

test("a stub mmdc that writes a file and exits 0: exit 0 and docs/links.svg holds its output", async () => {
  await withSandbox(async (dir, stubs, svg) => {
    await stubMmdc(stubs, writeStub);
    const r = await run(join(dir, "scripts", "diagram.sh"), [], { ...process.env, PATH: `${stubs}:${SYSTEM_PATH}` });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(await readFile(svg, "utf8"), "stub svg");
  });
});

test("a stub mmdc that exits non-zero: exit 1 and the existing docs/links.svg is unchanged", async () => {
  await withSandbox(async (dir, stubs, svg) => {
    const before = Buffer.from([0x3c, 0x73, 0x76, 0x67, 0x3e, 0x00, 0xff, 0x0a]);
    await writeFile(svg, before);
    await stubMmdc(stubs, `${writeStub}\nexit 3`);
    const r = await run(join(dir, "scripts", "diagram.sh"), [], { ...process.env, PATH: `${stubs}:${SYSTEM_PATH}` });
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /^error: mmdc failed rendering docs\/links\.mmd$/m);
    assert.ok(before.equals(await readFile(svg)), "docs/links.svg changed");
  });
});
