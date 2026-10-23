import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/links-config.sh", import.meta.url));
const packageJson = fileURLToPath(new URL("../package.json", import.meta.url));
const TIMEOUT_MS = 20000;

function findOnPath(name: string): string {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    try {
      accessSync(join(dir, name), constants.X_OK);
      return join(dir, name);
    } catch {}
  }
  throw new Error(`${name} is not on the PATH`);
}

type Result = { code: number | null; stdout: string; stderr: string };

type Setup = {
  // Content of links.config.yaml in the project root; undefined = no file.
  config?: string;
  // What the stub yq prints and its exit code; undefined yq = no yq on the PATH at all.
  // `err` is what it prints on stderr.
  yq?: { out: string; code?: number; err?: string };
  args?: string[];
  cwdOther?: boolean;
  npmCode?: number;
};

type Outcome = Result & {
  npmArgs: string[] | undefined;
  yqCalled: boolean;
  yqArgs: string[] | undefined;
  dir: string;
};

// One argument per line; undefined = the stub never ran.
function lines(raw: string | undefined): string[] | undefined {
  return raw === undefined ? undefined : raw.split("\n").slice(0, -1);
}

// Runs a copy of the script inside a temp project root (so the config is the one the test wrote),
// with a PATH that holds only the stubs and the two tools the script needs, so no real yq leaks in.
async function runScript(s: Setup): Promise<Outcome> {
  const dir = await mkdtemp(join(tmpdir(), "links-config-"));
  let child: ReturnType<typeof spawn> | undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    await mkdir(join(dir, "scripts"));
    await mkdir(join(dir, "bin"));
    await mkdir(join(dir, "elsewhere"));
    await copyFile(script, join(dir, "scripts", "links-config.sh"));
    if (s.config !== undefined) await writeFile(join(dir, "links.config.yaml"), s.config);
    for (const tool of ["dirname", "tr", "mktemp", "cat", "rm"]) {
      await symlink(findOnPath(tool), join(dir, "bin", tool));
    }
    await writeFile(
      join(dir, "bin", "npm"),
      `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > "${dir}/npm-args"\nexit "$NPM_CODE"\n`,
    );
    await chmod(join(dir, "bin", "npm"), 0o755);
    if (s.yq) {
      await writeFile(
        join(dir, "bin", "yq"),
        `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > "${dir}/yq-args"\n` +
          `printf '%s\\n' "$YQ_ERR" >&2\nprintf '%s\\n' "$YQ_OUT"\nexit "$YQ_CODE"\n`,
      );
      await chmod(join(dir, "bin", "yq"), 0o755);
    }
    const env = {
      PATH: join(dir, "bin"),
      YQ_OUT: s.yq?.out ?? "",
      YQ_ERR: s.yq?.err ?? "",
      YQ_CODE: String(s.yq?.code ?? 0),
      NPM_CODE: String(s.npmCode ?? 0),
    };
    const cwd = s.cwdOther ? join(dir, "elsewhere") : dir;
    // detached: the script gets its own process group, so a timeout can end it with its children.
    const c = spawn("/bin/sh", [join(dir, "scripts", "links-config.sh"), ...(s.args ?? [])], {
      env,
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    child = c;
    const closed = new Promise<number | null>((resolve) => c.on("close", resolve));
    let stdout = "";
    let stderr = "";
    c.stdout?.setEncoding("utf8");
    c.stderr?.setEncoding("utf8");
    c.stdout?.on("data", (d: string) => (stdout += d));
    c.stderr?.on("data", (d: string) => (stderr += d));
    const code = await Promise.race([
      closed,
      new Promise<never>((_, reject) => {
        c.on("error", reject);
        timer = setTimeout(
          () => reject(new Error(`script still running after ${TIMEOUT_MS} ms; stderr: ${stderr}`)),
          TIMEOUT_MS,
        );
      }),
    ]);
    const read = async (f: string) => readFile(join(dir, f), "utf8").catch(() => undefined);
    const yqArgs = lines(await read("yq-args"));
    return {
      code,
      stdout,
      stderr,
      npmArgs: lines(await read("npm-args")),
      yqCalled: yqArgs !== undefined,
      yqArgs,
      dir,
    };
  } finally {
    clearTimeout(timer);
    if (child && child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(-(child.pid as number), "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
    await rm(dir, { recursive: true, force: true });
  }
}

const page = ["page.html", "out.html"];

test("sort: true passes --sort and the arguments to npm run links", async () => {
  const r = await runScript({ config: "sort: true\n", yq: { out: "true" }, args: page });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.npmArgs, ["run", "links", "--", "--sort", ...page]);
});

test("sort: false passes no --sort", async () => {
  const r = await runScript({ config: "sort: false\n", yq: { out: "false" }, args: page });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.npmArgs, ["run", "links", "--", ...page]);
});

test("a missing sort key (yq prints null) passes no --sort", async () => {
  const r = await runScript({ config: "other: 1\n", yq: { out: "null" }, args: page });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.npmArgs, ["run", "links", "--", ...page]);
});

test("a missing config file passes no --sort and never calls yq", async () => {
  const r = await runScript({ yq: { out: "true" }, args: page });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.npmArgs, ["run", "links", "--", ...page]);
  assert.equal(r.yqCalled, false);
});

test("an invalid value is an error naming the file and the key", async () => {
  const r = await runScript({ config: "sort: maybe\n", yq: { out: "maybe" }, args: page });
  assert.equal(r.code, 1, r.stderr);
  assert.ok(r.stderr.includes("links.config.yaml"), r.stderr);
  assert.ok(r.stderr.includes("sort must be true or false, got: maybe"), r.stderr);
  assert.equal(r.npmArgs, undefined);
});

test("yq missing while the file exists is an error with the install hint", async () => {
  const r = await runScript({ config: "sort: true\n", args: page });
  assert.equal(r.code, 1, r.stderr);
  assert.ok(r.stderr.includes("brew install yq"), r.stderr);
  assert.equal(r.npmArgs, undefined);
});

test("yq missing and the file missing still runs unsorted", async () => {
  const r = await runScript({ args: page });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.npmArgs, ["run", "links", "--", ...page]);
});

test("a failing yq is an error and no run, even when it printed a valid value", async () => {
  const r = await runScript({
    config: "sort: [\n",
    yq: { out: "true", code: 1, err: "Error: bad file" },
    args: page,
  });
  assert.equal(r.code, 1, r.stderr);
  assert.ok(r.stderr.includes("yq failed on links.config.yaml (exit 1): Error: bad file"), r.stderr);
  assert.equal(r.npmArgs, undefined);
});

test("a yq that succeeds but warns on stderr still gives its value", async () => {
  const r = await runScript({ config: "sort: true\n", yq: { out: "true", err: "warning: old syntax" }, args: page });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.npmArgs, ["run", "links", "--", "--sort", ...page]);
});

test("yq is asked for .sort of links.config.yaml in the project root", async () => {
  const r = await runScript({ config: "sort: true\n", yq: { out: "true" }, args: page, cwdOther: true });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.yqArgs, [".sort", join(r.dir, "links.config.yaml")]);
});

test("arguments with spaces stay single arguments and the exit code of npm is passed on", async () => {
  const args = ["my page.html", "out page.html"];
  const r = await runScript({ config: "sort: false\n", yq: { out: "false" }, args, npmCode: 3 });
  assert.equal(r.code, 3, r.stderr);
  assert.deepEqual(r.npmArgs, ["run", "links", "--", ...args]);
});

test("an explicit --sort with sort: false is passed on", async () => {
  const r = await runScript({ config: "sort: false\n", yq: { out: "false" }, args: ["--sort", ...page] });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.npmArgs?.includes("--sort"), String(r.npmArgs));
  assert.deepEqual(r.npmArgs, ["run", "links", "--", "--sort", ...page]);
});

test("started from another working directory the result is the same", async () => {
  const r = await runScript({ config: "sort: true\n", yq: { out: "true" }, args: page, cwdOther: true });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.npmArgs, ["run", "links", "--", "--sort", ...page]);
});

test("a control character in the value is not printed raw", async () => {
  const r = await runScript({ config: "sort: x\n", yq: { out: "may\u001b[2Jbe" }, args: page });
  assert.equal(r.code, 1, r.stderr);
  assert.ok(!r.stderr.includes("\u001b"), JSON.stringify(r.stderr));
  assert.ok(r.stderr.includes("got: may[2Jbe"), JSON.stringify(r.stderr));
});

test("package.json has the links:config script", async () => {
  const pkg = JSON.parse(await readFile(packageJson, "utf8"));
  assert.equal(pkg.scripts["links:config"], "sh scripts/links-config.sh");
});
