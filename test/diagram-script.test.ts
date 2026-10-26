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

// The stub logs "<format> <input> <output>" per call to $STUB_LOG, fails if the input is not an existing file, writes to
// the file after `-o` as mmdc does, and like mmdc refuses an output name not ending in .<format>. The render options are
// logged as the remaining arguments, so a test can see that nothing but -i, -o and -e was passed.
const writeStub = `fmt=""
opts=""
while [ $# -gt 0 ]; do
  case "$1" in
    -i) in="$2"; shift ;;
    -o) out="$2"; shift ;;
    -e) fmt="$2"; shift ;;
    *) opts="$opts $1" ;;
  esac
  shift
done
[ -f "$in" ] || { echo "input is not a file: $in" >&2; exit 5; }
case "$out" in *."$fmt") ;; *) echo "output must end in .$fmt" >&2; exit 4 ;; esac
printf '%s\\n%s\\n%s\\n%s\\n' "$fmt" "$in" "$out" "$opts" >> "$STUB_LOG"
printf 'stub %s' "$fmt" > "$out"`;

type Call = { format: string; input: string; output: string; opts: string };

// The calls the stub logged, four lines each: format, input, output, extra options.
async function stubCalls(log: string): Promise<Call[]> {
  const lines = (await readFile(log, "utf8")).split("\n");
  const calls: Call[] = [];
  for (let i = 0; i + 3 < lines.length; i += 4) {
    calls.push({ format: lines[i], input: lines[i + 1], output: lines[i + 2], opts: lines[i + 3].trim() });
  }
  return calls;
}

function pngOf(dir: string): string {
  return join(dir, "docs", "links.png");
}

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
    const pngBefore = await readFile(pngOf(dir));
    const r = await run(join(dir, "scripts", "diagram.sh"), [], envWith(stubs, join(dir, "log"), stubs));
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /^error: mmdc is not installed/);
    assert.equal(r.stdout, "");
    assert.ok(before.equals(await readFile(svg)), "docs/links.svg changed");
    assert.ok(pngBefore.equals(await readFile(pngOf(dir))), "docs/links.png changed");
  });
});

test("any argument: exit 2, the usage line, mmdc is not run", async () => {
  await withSandbox(async (dir, stubs, svg) => {
    await stubMmdc(stubs, writeStub);
    const before = await readFile(svg);
    const pngBefore = await readFile(pngOf(dir));
    for (const args of [["extra"], ["a", "b"], [""]]) {
      const r = await run(join(dir, "scripts", "diagram.sh"), args, envWith(stubs, join(dir, "log")));
      assert.equal(r.code, 2, r.stderr);
      assert.match(r.stderr, /^usage: npm run diagram$/m);
      assert.equal(r.stdout, "");
    }
    assert.ok(before.equals(await readFile(svg)), "docs/links.svg changed");
    assert.ok(pngBefore.equals(await readFile(pngOf(dir))), "docs/links.png changed");
    await assert.rejects(readFile(join(dir, "log")), { code: "ENOENT" });
  });
});

test("a stub mmdc that writes a file and exits 0: exit 0 and docs/links.svg and docs/links.png hold its output", async () => {
  await withSandbox(async (dir, stubs, svg) => {
    await stubMmdc(stubs, writeStub);
    const log = join(dir, "log");
    const r = await run(join(dir, "scripts", "diagram.sh"), [], envWith(stubs, log));
    assert.equal(r.code, 0, r.stderr);
    assert.equal(await readFile(svg, "utf8"), "stub svg");
    assert.equal(await readFile(pngOf(dir), "utf8"), "stub png");
    assert.equal(r.stdout, "");
    const calls = await stubCalls(log);
    assert.deepEqual(calls.map((c) => c.format).sort(), ["png", "svg"]);
    for (const call of calls) {
      assert.equal(call.input, `${dir}/scripts/../docs/links.mmd`);
      assert.match(
        call.output,
        new RegExp(`^${escapeRegExp(`${dir}/scripts/../docs`)}/\\.diagram\\.[^/]+/links\\.${call.format}$`),
      );
      assert.equal(call.opts, "", `${call.format} was rendered with options: ${call.opts}`);
    }
    assert.deepEqual(await leftovers(dir), []);
  });
});

test("a stub mmdc that exits non-zero after writing: exit 1 and docs/links.svg and docs/links.png are unchanged", async () => {
  await withSandbox(async (dir, stubs, svg) => {
    const before = Buffer.from([0x3c, 0x73, 0x76, 0x67, 0x3e, 0x00, 0xff, 0x0a]);
    await writeFile(svg, before);
    const pngBefore = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    await writeFile(pngOf(dir), pngBefore);
    await stubMmdc(stubs, `${writeStub}\nexit 3`);
    const log = join(dir, "log");
    const r = await run(join(dir, "scripts", "diagram.sh"), [], envWith(stubs, log));
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /^error: mmdc failed rendering docs\/links\.mmd$/m);
    const [call] = await stubCalls(log);
    assert.match(
      call.output,
      new RegExp(`^${escapeRegExp(`${dir}/scripts/../docs`)}/\\.diagram\\.[^/]+/links\\.${call.format}$`),
    );
    assert.ok(before.equals(await readFile(svg)), "docs/links.svg changed");
    assert.ok(pngBefore.equals(await readFile(pngOf(dir))), "docs/links.png changed");
    assert.deepEqual(await leftovers(dir), []);
  });
});

for (const failing of ["png", "svg"]) {
  test(`a stub mmdc that fails only for ${failing}: exit 1 and both docs/links.svg and docs/links.png are unchanged`, async () => {
    await withSandbox(async (dir, stubs, svg) => {
      const svgBefore = await readFile(svg);
      const pngBefore = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
      await writeFile(pngOf(dir), pngBefore);
      await stubMmdc(stubs, `${writeStub}\n[ "$fmt" = "${failing}" ] && exit 3\nexit 0`);
      const r = await run(join(dir, "scripts", "diagram.sh"), [], envWith(stubs, join(dir, "log")));
      assert.equal(r.code, 1, r.stderr);
      assert.match(r.stderr, /^error: mmdc failed rendering docs\/links\.mmd$/m);
      assert.ok(svgBefore.equals(await readFile(svg)), "docs/links.svg changed");
      assert.ok(pngBefore.equals(await readFile(pngOf(dir))), "docs/links.png changed");
      assert.deepEqual(await leftovers(dir), []);
    });
  });

  test(`a stub mmdc that fails only for ${failing}, with no docs/links.png yet: no docs/links.png appears`, async () => {
    await withSandbox(async (dir, stubs, svg) => {
      const svgBefore = await readFile(svg);
      await rm(pngOf(dir), { force: true });
      await stubMmdc(stubs, `${writeStub}\n[ "$fmt" = "${failing}" ] && exit 3\nexit 0`);
      const r = await run(join(dir, "scripts", "diagram.sh"), [], envWith(stubs, join(dir, "log")));
      assert.equal(r.code, 1, r.stderr);
      assert.ok(svgBefore.equals(await readFile(svg)), "docs/links.svg changed");
      await assert.rejects(readFile(pngOf(dir)), { code: "ENOENT" });
      assert.deepEqual(await leftovers(dir), []);
    });
  });

  test(`a stub mmdc that writes an empty ${failing} file: exit 1 and both targets are unchanged`, async () => {
    await withSandbox(async (dir, stubs, svg) => {
      const svgBefore = await readFile(svg);
      const pngBefore = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
      await writeFile(pngOf(dir), pngBefore);
      await stubMmdc(stubs, `${writeStub}\n[ "$fmt" = "${failing}" ] && : > "$out"\nexit 0`);
      const r = await run(join(dir, "scripts", "diagram.sh"), [], envWith(stubs, join(dir, "log")));
      assert.equal(r.code, 1, r.stderr);
      assert.match(r.stderr, /^error: mmdc wrote no output for docs\/links\.mmd$/m);
      assert.ok(svgBefore.equals(await readFile(svg)), "docs/links.svg changed");
      assert.ok(pngBefore.equals(await readFile(pngOf(dir))), "docs/links.png changed");
      assert.deepEqual(await leftovers(dir), []);
    });
  });
}

test("a stub mmdc that exits 0 and writes nothing: exit 1 and the existing docs/links.svg is unchanged", async () => {
  await withSandbox(async (dir, stubs, svg) => {
    const before = await readFile(svg);
    const pngBefore = await readFile(pngOf(dir));
    await stubMmdc(stubs, `: > /dev/null`);
    const r = await run(join(dir, "scripts", "diagram.sh"), [], envWith(stubs, join(dir, "log")));
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /^error: mmdc wrote no output for docs\/links\.mmd$/m);
    assert.ok(before.equals(await readFile(svg)), "docs/links.svg changed");
    assert.ok(pngBefore.equals(await readFile(pngOf(dir))), "docs/links.png changed");
    assert.deepEqual(await leftovers(dir), []);
  });
});

test("a stub mmdc that exits 0 and writes an empty file: exit 1 and the existing docs/links.svg is unchanged", async () => {
  await withSandbox(async (dir, stubs, svg) => {
    const before = await readFile(svg);
    const pngBefore = await readFile(pngOf(dir));
    await stubMmdc(stubs, `while [ $# -gt 0 ]; do [ "$1" = "-o" ] && : > "$2"; shift; done`);
    const r = await run(join(dir, "scripts", "diagram.sh"), [], envWith(stubs, join(dir, "log")));
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /^error: mmdc wrote no output for docs\/links\.mmd$/m);
    assert.ok(before.equals(await readFile(svg)), "docs/links.svg changed");
    assert.ok(pngBefore.equals(await readFile(pngOf(dir))), "docs/links.png changed");
    assert.deepEqual(await leftovers(dir), []);
  });
});

test("a missing docs/links.mmd: exit 1 and the missing-source message", async () => {
  await withSandbox(async (dir, stubs) => {
    await stubMmdc(stubs, writeStub);
    await rm(join(dir, "docs", "links.mmd"));
    const svg = join(dir, "docs", "links.svg");
    const before = await readFile(svg);
    const pngBefore = await readFile(pngOf(dir));
    const r = await run(join(dir, "scripts", "diagram.sh"), [], envWith(stubs, join(dir, "log")));
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /^error: docs\/links\.mmd is missing$/m);
    assert.equal(r.stdout, "");
    assert.ok(before.equals(await readFile(svg)), "docs/links.svg changed");
    assert.ok(pngBefore.equals(await readFile(pngOf(dir))), "docs/links.png changed");
    await assert.rejects(readFile(join(dir, "log")), { code: "ENOENT" });
    assert.deepEqual(await leftovers(dir), []);
  });
});

test("docs/links.svg is a directory: exit 1 and the message, mmdc is not run", async () => {
  await withSandbox(async (dir, stubs, svg) => {
    await stubMmdc(stubs, writeStub);
    const pngBefore = await readFile(pngOf(dir));
    await rm(svg);
    await mkdir(svg);
    const r = await run(join(dir, "scripts", "diagram.sh"), [], envWith(stubs, join(dir, "log")));
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /^error: docs\/links\.svg is a directory$/m);
    assert.equal(r.stdout, "");
    assert.ok((await stat(svg)).isDirectory(), "docs/links.svg is no longer a directory");
    assert.ok(pngBefore.equals(await readFile(pngOf(dir))), "docs/links.png changed");
    await assert.rejects(readFile(join(dir, "log")), { code: "ENOENT" });
    assert.deepEqual(await leftovers(dir), []);
  });
});

test("docs/links.png is a directory: exit 1 and the message, mmdc is not run", async () => {
  await withSandbox(async (dir, stubs, svg) => {
    await stubMmdc(stubs, writeStub);
    const svgBefore = await readFile(svg);
    await rm(pngOf(dir), { force: true });
    await mkdir(pngOf(dir));
    const r = await run(join(dir, "scripts", "diagram.sh"), [], envWith(stubs, join(dir, "log")));
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /^error: docs\/links\.png is a directory$/m);
    assert.equal(r.stdout, "");
    assert.ok((await stat(pngOf(dir))).isDirectory(), "docs/links.png is no longer a directory");
    assert.ok(svgBefore.equals(await readFile(svg)), "docs/links.svg changed");
    await assert.rejects(readFile(join(dir, "log")), { code: "ENOENT" });
    assert.deepEqual(await leftovers(dir), []);
  });
});

// A stub mv in front of the PATH that records its arguments to $STUB_MV_LOG, one line per call, fails for the target
// named and otherwise does what /bin/mv does.
async function stubMv(stubs: string, failFor: string): Promise<void> {
  const file = join(stubs, "mv");
  await writeFile(
    file,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "$STUB_MV_LOG"\ncase "$*" in *"${failFor}") echo "mv: stub refuses" >&2; exit 1 ;; esac\nexec /bin/mv "$@"\n`,
  );
  await chmod(file, 0o755);
}

// The arguments of every mv call the stub recorded.
async function stubMvCalls(log: string): Promise<string[]> {
  return (await readFile(log, "utf8")).split("\n").filter((line) => line !== "");
}

test("the second mv failing: exit 1, the message says the SVG was already replaced, no temp directory is left", async () => {
  await withSandbox(async (dir, stubs, svg) => {
    await stubMmdc(stubs, writeStub);
    await stubMv(stubs, "links.png");
    const pngBefore = await readFile(pngOf(dir));
    const mvLog = join(dir, "mv-log");
    const r = await run(join(dir, "scripts", "diagram.sh"), [], {
      ...envWith(stubs, join(dir, "log")),
      STUB_MV_LOG: mvLog,
    });
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /^error: cannot replace docs\/links\.png \(docs\/links\.svg was already replaced\)$/m);
    assert.equal(await readFile(svg, "utf8"), "stub svg");
    assert.ok(pngBefore.equals(await readFile(pngOf(dir))), "docs/links.png changed");
    const mvCalls = await stubMvCalls(mvLog);
    assert.equal(mvCalls.length, 2, mvCalls.join("\n"));
    assert.match(
      mvCalls[0],
      new RegExp(
        `^-f ${escapeRegExp(dir)}/scripts/\\.\\./docs/\\.diagram\\.[^/]+/links\\.svg ${escapeRegExp(dir)}/scripts/\\.\\./docs/links\\.svg$`,
      ),
    );
    assert.match(
      mvCalls[1],
      new RegExp(
        `^-f ${escapeRegExp(dir)}/scripts/\\.\\./docs/\\.diagram\\.[^/]+/links\\.png ${escapeRegExp(dir)}/scripts/\\.\\./docs/links\\.png$`,
      ),
    );
    assert.deepEqual(await leftovers(dir), []);
  });
});

test("the first mv failing: exit 1, the message names the SVG, and neither file changed", async () => {
  await withSandbox(async (dir, stubs, svg) => {
    await stubMmdc(stubs, writeStub);
    await stubMv(stubs, "links.svg");
    const svgBefore = await readFile(svg);
    const pngBefore = await readFile(pngOf(dir));
    const mvLog = join(dir, "mv-log");
    const r = await run(join(dir, "scripts", "diagram.sh"), [], {
      ...envWith(stubs, join(dir, "log")),
      STUB_MV_LOG: mvLog,
    });
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /^error: cannot replace docs\/links\.svg$/m);
    assert.ok(svgBefore.equals(await readFile(svg)), "docs/links.svg changed");
    assert.ok(pngBefore.equals(await readFile(pngOf(dir))), "docs/links.png changed");
    const mvCalls = await stubMvCalls(mvLog);
    assert.equal(mvCalls.length, 1, `the png is not moved after the svg move failed: ${mvCalls.join("; ")}`);
    assert.match(mvCalls[0], /^-f \S+\/links\.svg \S+\/docs\/links\.svg$/);
    assert.deepEqual(await leftovers(dir), []);
  });
});
