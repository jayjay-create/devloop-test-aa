import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
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
  // Answers of the stub yq per expression (the first argument) other than `.sort`; an expression that is not
  // listed gets the answer of a config without the key: `!!null` for the type, `0` for the newline count, nothing otherwise.
  yqBy?: Record<string, { out: string; code?: number }>;
  args?: string[];
  cwdOther?: boolean;
  npmCode?: number;
  // TMPDIR of the run, relative to the project root; the default is a directory that exists.
  tmpDir?: string;
};

type Outcome = Result & {
  npmArgs: string[] | undefined;
  yqCalled: boolean;
  yqArgs: string[] | undefined;
  // The expression of every yq call, in order.
  yqExprs: string[];
  // The file argument of every yq call, in order.
  yqFiles: string[];
  // The project root the run used; it is removed when runScript returns, so only its name is of use.
  dir: string;
  // Files the script left in its TMPDIR.
  tmpLeft: string[];
  // Files in its TMPDIR at the moment yq ran; undefined = yq never ran.
  tmpDuring: string[] | undefined;
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
    await mkdir(join(dir, "tmp"));
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
      // Answers per expression: files in bin/, chosen by a case on the first argument.
      const by: Record<string, { out: string; code?: number }> = {
        ".exclude | tag": { out: "!!null" },
        '[.exclude[] | select(contains("\\n"))] | length': { out: "0" },
        ".title | tag": { out: "!!null" },
        '.title | contains("\\n")': { out: "false" },
        ...s.yqBy,
      };
      let cases = "";
      let i = 0;
      for (const [expr, answer] of Object.entries(by)) {
        const file = join(dir, "bin", `yq-answer-${String(i++)}`);
        await writeFile(file, `${answer.out}\n`);
        cases += `  '${expr.replaceAll("'", "'\\''")}') cat "${file}"; exit ${String(answer.code ?? 0)} ;;\n`;
      }
      await writeFile(
        join(dir, "bin", "yq"),
        // yq-args keeps the arguments of the first call; yq-exprs lists the expression of every call.
        `#!/bin/sh\nif [ ! -f "${dir}/yq-args" ]; then for a in "$@"; do printf '%s\\n' "$a"; done > "${dir}/yq-args"; fi\n` +
          `printf '%s\\n' "$1" >> "${dir}/yq-exprs"\n` +
          // Only $2: the other arguments are constants of the expressions, asserted through yq-exprs.
          `printf '%s\\n' "$2" >> "${dir}/yq-files"\n` +
          // The names in TMPDIR while yq runs; a glob, since ls is not on the PATH of the run.
          `for f in "$TMPDIR"/*; do printf '%s\\n' "\${f##*/}"; done > "${dir}/yq-tmp"\n` +
          `printf '%s\\n' "$YQ_ERR" >&2\n` +
          `case "$1" in\n${cases}esac\n` +
          `case "$1" in\n  .sort) printf '%s\\n' "$YQ_OUT"; exit "$YQ_CODE" ;;\nesac\nexit 0\n`,
      );
      await chmod(join(dir, "bin", "yq"), 0o755);
    }
    const env = {
      PATH: join(dir, "bin"),
      TMPDIR: join(dir, s.tmpDir ?? "tmp"),
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
      yqExprs: lines(await read("yq-exprs")) ?? [],
      yqFiles: lines(await read("yq-files")) ?? [],
      dir,
      tmpLeft: await readdir(join(dir, "tmp")),
      tmpDuring: lines(await read("yq-tmp")),
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
  assert.ok(r.stderr.includes("yq failed on links.config.yaml (exit 1): Error: bad file\n"), r.stderr);
  assert.ok(!r.stderr.includes("true"), r.stderr);
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

const spaced = ["my page.html", "out page.html"];

test("arguments with spaces stay single arguments without --sort", async () => {
  const r = await runScript({ config: "sort: false\n", yq: { out: "false" }, args: spaced });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.npmArgs, ["run", "links", "--", ...spaced]);
});

test("arguments with spaces stay single arguments with --sort", async () => {
  const r = await runScript({ config: "sort: true\n", yq: { out: "true" }, args: spaced });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.npmArgs, ["run", "links", "--", "--sort", ...spaced]);
});

test("the exit code of npm run links is passed on", async () => {
  const r = await runScript({ config: "sort: false\n", yq: { out: "false" }, args: page, npmCode: 3 });
  assert.equal(r.code, 3, r.stderr);
});

test("a failing yq without a message shows its output instead", async () => {
  const r = await runScript({ config: "sort: [\n", yq: { out: "garbled", code: 2 }, args: page });
  assert.equal(r.code, 1, r.stderr);
  assert.ok(r.stderr.includes("yq failed on links.config.yaml (exit 2): garbled"), r.stderr);
});

test("a control character in the message of a failing yq is not printed raw", async () => {
  const r = await runScript({
    config: "sort: [\n",
    yq: { out: "", code: 1, err: "bad\u001b[2J file\nsecond line" },
    args: page,
  });
  assert.equal(r.code, 1, r.stderr);
  assert.ok(!r.stderr.includes("\u001b"), JSON.stringify(r.stderr));
  assert.ok(r.stderr.includes("(exit 1): bad[2J filesecond line"), JSON.stringify(r.stderr));
  assert.equal(r.stderr.split("\n").length, 2, JSON.stringify(r.stderr));
});

test("the temporary file for yq's messages stands in TMPDIR while yq runs and is gone on every way out", async () => {
  const ok = await runScript({ config: "sort: true\n", yq: { out: "true", err: "warning" }, args: page });
  assert.equal(ok.tmpDuring?.length, 1, String(ok.tmpDuring));
  assert.ok(ok.tmpDuring?.[0]?.startsWith("links-config."), String(ok.tmpDuring));
  const invalid = await runScript({ config: "sort: x\n", yq: { out: "x" }, args: page });
  const failing = await runScript({ config: "sort: [\n", yq: { out: "", code: 1, err: "bad" }, args: page });
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(invalid.code, 1, invalid.stderr);
  assert.equal(failing.code, 1, failing.stderr);
  assert.deepEqual([ok.tmpLeft, invalid.tmpLeft, failing.tmpLeft], [[], [], []]);
});

test("a temporary directory that cannot be used is an error naming the cause", async () => {
  const r = await runScript({ config: "sort: true\n", yq: { out: "true" }, args: page, tmpDir: "missing-tmp" });
  assert.equal(r.code, 1, r.stderr);
  assert.ok(r.stderr.includes("cannot create a temporary file"), r.stderr);
  assert.ok(r.stderr.includes("(check TMPDIR)"), r.stderr);
  assert.equal(r.npmArgs, undefined);
  assert.equal(r.yqCalled, false);
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

const titleExprs = {
  tag: ".title | tag",
  newline: '.title | contains("\\n")',
  text: ".title",
};

const patternExprs = {
  tag: ".exclude | tag",
  items: ".exclude[] | tag",
  newline: '[.exclude[] | select(contains("\\n"))] | length',
  list: ".exclude[]",
};

// A config with an exclude list as the stub yq would read it.
function excludeOf(...patterns: string[]): Pick<Setup, "config" | "yqBy"> {
  return {
    config: `exclude: ${JSON.stringify(patterns)}\n`,
    yqBy: {
      [patternExprs.tag]: { out: "!!seq" },
      [patternExprs.items]: { out: patterns.map(() => "!!str").join("\n") },
      [patternExprs.newline]: { out: "0" },
      [patternExprs.list]: { out: patterns.join("\n") },
    },
  };
}

test("exclude: [a, b] passes one --exclude per pattern, after --sort and before the arguments", async () => {
  const r = await runScript({ ...excludeOf("a", "b"), yq: { out: "true" }, args: page });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.npmArgs, ["run", "links", "--", "--sort", "--exclude=a", "--exclude=b", ...page]);
});

test("exclude without sort passes only the --exclude arguments", async () => {
  const r = await runScript({ ...excludeOf("*.pdf"), yq: { out: "null" }, args: page });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.npmArgs, ["run", "links", "--", "--exclude=*.pdf", ...page]);
});

test("patterns with spaces, quotes, backslashes and a leading space stay single arguments", async () => {
  const patterns = ["a b*", ' "q" ', "x\\y*", "*'z"];
  const r = await runScript({ ...excludeOf(...patterns), yq: { out: "false" }, args: spaced });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.npmArgs, ["run", "links", "--", ...patterns.map((p) => `--exclude=${p}`), ...spaced]);
});

test("yq is asked for the type of exclude, the type of its items, newlines in them and then the patterns", async () => {
  const r = await runScript({ ...excludeOf("a"), yq: { out: "false" }, args: page });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.yqExprs, [
    ".sort",
    patternExprs.tag,
    patternExprs.items,
    patternExprs.newline,
    patternExprs.list,
    titleExprs.tag,
  ]);
  assert.equal(r.yqArgs?.[0], ".sort");
  // Every call reads the config of the project root, not only the first.
  assert.deepEqual(r.yqFiles, Array(6).fill(join(r.dir, "links.config.yaml")));
});

test("exclude: [] (a list without items) passes nothing", async () => {
  const r = await runScript({
    config: "exclude: []\n",
    yq: { out: "null" },
    yqBy: { [patternExprs.tag]: { out: "!!seq" } },
    args: page,
  });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.npmArgs, ["run", "links", "--", ...page]);
});

test("a missing exclude key passes nothing and asks no further than its type", async () => {
  const r = await runScript({ config: "sort: false\n", yq: { out: "false" }, args: page });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.npmArgs, ["run", "links", "--", ...page]);
  assert.deepEqual(r.yqExprs, [".sort", patternExprs.tag, titleExprs.tag]);
});

test("exclude that is not a list is an error naming the file and the key; npm is not called", async () => {
  for (const tag of ["!!int", "!!str", "!!map", "!!bool"]) {
    const r = await runScript({
      config: "exclude: 5\n",
      yq: { out: "null" },
      yqBy: { [patternExprs.tag]: { out: tag } },
      args: page,
    });
    assert.equal(r.code, 1, r.stderr);
    assert.equal(r.stderr, "error: links.config.yaml: exclude must be a list of text\n", tag);
    assert.equal(r.npmArgs, undefined);
    assert.equal(r.stdout, "");
  }
});

test("exclude with an item that is not text is an error naming the file and the key; npm is not called", async () => {
  const r = await runScript({
    config: "exclude: [1]\n",
    yq: { out: "null" },
    yqBy: { [patternExprs.tag]: { out: "!!seq" }, [patternExprs.items]: { out: "!!str\n!!int" } },
    args: page,
  });
  assert.equal(r.code, 1, r.stderr);
  assert.equal(r.stderr, "error: links.config.yaml: exclude must be a list of text\n");
  assert.equal(r.npmArgs, undefined);
});

test("a pattern with a newline is an error (exit 1) naming the key; npm is not called", async () => {
  const r = await runScript({
    ...excludeOf("a", "b"),
    yq: { out: "null" },
    yqBy: {
      [patternExprs.tag]: { out: "!!seq" },
      [patternExprs.items]: { out: "!!str\n!!str" },
      [patternExprs.newline]: { out: "1" },
      [patternExprs.list]: { out: "a\nb" },
    },
    args: page,
  });
  assert.equal(r.code, 1, r.stderr);
  assert.equal(r.stderr, "error: links.config.yaml: an exclude pattern must not contain a newline\n");
  assert.equal(r.npmArgs, undefined);
});

test("a failing yq on exclude is an error with its message even when it printed a valid answer; npm is not called", async () => {
  const r = await runScript({
    config: "exclude: [\n",
    yq: { out: "null", err: "bad file" },
    yqBy: { [patternExprs.tag]: { out: "!!null", code: 1 } },
    args: page,
  });
  assert.equal(r.code, 1, r.stderr);
  assert.ok(r.stderr.includes("yq failed on links.config.yaml (exit 1): bad file"), r.stderr);
  assert.equal(r.npmArgs, undefined);
});

test("a control character in the message of a failing yq on exclude is not printed raw", async () => {
  const failing = await runScript({
    config: "exclude: [\n",
    yq: { out: "null", err: "bad\u001b[2J file" },
    yqBy: { [patternExprs.tag]: { out: "!!null", code: 1 } },
    args: page,
  });
  assert.equal(failing.code, 1, failing.stderr);
  assert.ok(!failing.stderr.includes("\u001b"), JSON.stringify(failing.stderr));
  assert.ok(failing.stderr.includes("(exit 1): bad[2J file"), JSON.stringify(failing.stderr));
  assert.equal(failing.npmArgs, undefined);
  assert.equal(failing.stdout, "");
});

test("a control character inside a pattern reaches --exclude= exactly as typed", async () => {
  const patterns = ["a\u001b[2Jb*", "x\ty*"];
  const r = await runScript({ ...excludeOf(...patterns), yq: { out: "false" }, args: page });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.npmArgs, ["run", "links", "--", ...patterns.map((p) => `--exclude=${p}`), ...page]);
});

test("no config file: no exclude arguments and yq is never called", async () => {
  const r = await runScript({ yq: { out: "true" }, args: page });
  assert.deepEqual(r.npmArgs, ["run", "links", "--", ...page]);
  assert.deepEqual(r.yqExprs, []);
});

test("the temporary file is gone after an exclude error and after a pattern run", async () => {
  const bad = await runScript({
    config: "exclude: 5\n",
    yq: { out: "null" },
    yqBy: { [patternExprs.tag]: { out: "!!int" } },
    args: page,
  });
  const ok = await runScript({ ...excludeOf("a"), yq: { out: "false" }, args: page });
  assert.equal(bad.code, 1, bad.stderr);
  assert.equal(ok.code, 0, ok.stderr);
  assert.deepEqual([bad.tmpLeft, ok.tmpLeft], [[], []]);
});

test("an empty pattern is passed as --exclude= wherever it stands in the list (alone, first, last, in the middle, repeated)", async () => {
  for (const patterns of [[""], ["a", ""], ["", "a"], ["", ""], ["a", "", "b"]]) {
    const r = await runScript({ ...excludeOf(...patterns), yq: { out: "false" }, args: page });
    assert.equal(r.code, 0, `${JSON.stringify(patterns)}: ${r.stderr}`);
    assert.deepEqual(
      r.npmArgs,
      ["run", "links", "--", ...patterns.map((p) => `--exclude=${p}`), ...page],
      JSON.stringify(patterns),
    );
  }
});

// A config with a title as the stub yq would read it.
function titleOf(title: string): Pick<Setup, "config" | "yqBy"> {
  return {
    config: `title: ${JSON.stringify(title)}\n`,
    yqBy: {
      [titleExprs.tag]: { out: "!!str" },
      [titleExprs.newline]: { out: "false" },
      [titleExprs.text]: { out: title },
    },
  };
}

test('title: "My links" passes --title=My links as one argument, before the arguments', async () => {
  const r = await runScript({ ...titleOf("My links"), yq: { out: "null" }, args: page });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.npmArgs, ["run", "links", "--", "--title=My links", ...page]);
});

test("a title reaches --title= exactly as typed: &, <, quotes, a leading dash, control characters, backslashes", async () => {
  for (const title of ["A <b> & \"c\" 'd'", "-x --sort", "a\u001b[2Jb\tc", "x\\y *", "=", " lead and trail "]) {
    const r = await runScript({ ...titleOf(title), yq: { out: "null" }, args: spaced });
    assert.equal(r.code, 0, `${JSON.stringify(title)}: ${r.stderr}`);
    assert.deepEqual(r.npmArgs, ["run", "links", "--", `--title=${title}`, ...spaced], JSON.stringify(title));
  }
});

test('title: "" passes nothing', async () => {
  const r = await runScript({ ...titleOf(""), yq: { out: "null" }, args: page });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.npmArgs, ["run", "links", "--", ...page]);
});

test("a missing title key passes nothing and asks only for its type", async () => {
  const r = await runScript({ config: "sort: false\n", yq: { out: "false" }, args: page });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.npmArgs, ["run", "links", "--", ...page]);
  assert.equal(r.yqExprs.at(-1), titleExprs.tag);
  assert.ok(!r.yqExprs.includes(titleExprs.text), String(r.yqExprs));
});

test("yq is asked for the type of title, newlines in it and then the title, each on the config of the project root", async () => {
  const r = await runScript({ ...titleOf("T"), yq: { out: "null" }, args: page });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.yqExprs.slice(-3), [titleExprs.tag, titleExprs.newline, titleExprs.text]);
  assert.deepEqual(r.yqFiles, Array(r.yqExprs.length).fill(join(r.dir, "links.config.yaml")));
});

test("title that is not text is an error naming the file and the key; npm is not called", async () => {
  for (const tag of ["!!seq", "!!map", "!!int", "!!bool", "!!float"]) {
    const r = await runScript({
      config: "title: [a]\n",
      yq: { out: "null" },
      yqBy: { [titleExprs.tag]: { out: tag } },
      args: page,
    });
    assert.equal(r.code, 1, `${tag}: ${r.stderr}`);
    assert.equal(r.stderr, "error: links.config.yaml: title must be text\n", tag);
    assert.equal(r.npmArgs, undefined, tag);
    assert.equal(r.stdout, "", tag);
  }
});

test("a title with a newline is an error (exit 1) naming the key; npm is not called", async () => {
  const r = await runScript({
    ...titleOf("a\nb"),
    yq: { out: "null" },
    yqBy: { [titleExprs.tag]: { out: "!!str" }, [titleExprs.newline]: { out: "true" } },
    args: page,
  });
  assert.equal(r.code, 1, r.stderr);
  assert.equal(r.stderr, "error: links.config.yaml: a title must not contain a newline\n");
  assert.equal(r.npmArgs, undefined);
});

test("a failing yq on title is an error with its message, printed without control characters; npm is not called", async () => {
  const r = await runScript({
    config: "title: [\n",
    yq: { out: "null", err: "bad\u001b[2J file" },
    yqBy: { [titleExprs.tag]: { out: "!!null", code: 1 } },
    args: page,
  });
  assert.equal(r.code, 1, r.stderr);
  assert.ok(!r.stderr.includes("\u001b"), JSON.stringify(r.stderr));
  assert.ok(r.stderr.includes("(exit 1): bad[2J file"), JSON.stringify(r.stderr));
  assert.equal(r.npmArgs, undefined);
});

test("exclude and title together pass both, after --sort and before the arguments", async () => {
  const r = await runScript({
    ...excludeOf("a", "b"),
    yqBy: { ...excludeOf("a", "b").yqBy, ...titleOf("T t").yqBy },
    yq: { out: "true" },
    args: page,
  });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.npmArgs, ["run", "links", "--", "--sort", "--exclude=a", "--exclude=b", "--title=T t", ...page]);
});

test("exclude alone passes no --title, title alone passes no --exclude", async () => {
  const onlyExclude = await runScript({ ...excludeOf("a"), yq: { out: "null" }, args: page });
  assert.deepEqual(onlyExclude.npmArgs, ["run", "links", "--", "--exclude=a", ...page]);
  const onlyTitle = await runScript({ ...titleOf("T"), yq: { out: "null" }, args: page });
  assert.deepEqual(onlyTitle.npmArgs, ["run", "links", "--", "--title=T", ...page]);
});

test("the temporary file is gone after a title error and after a title run", async () => {
  const bad = await runScript({
    config: "title: [a]\n",
    yq: { out: "null" },
    yqBy: { [titleExprs.tag]: { out: "!!seq" } },
    args: page,
  });
  const ok = await runScript({ ...titleOf("T"), yq: { out: "null" }, args: page });
  assert.equal(bad.code, 1, bad.stderr);
  assert.equal(ok.code, 0, ok.stderr);
  assert.deepEqual([bad.tmpLeft, ok.tmpLeft], [[], []]);
});
