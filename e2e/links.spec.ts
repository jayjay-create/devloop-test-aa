import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const INPUT = "https://a.example/\nrel/b.html\nhttps://a.example/\nhttps://c.example/?x=1&y=<2>\n";
const EXPECTED = ["https://a.example/", "rel/b.html", "https://c.example/?x=1&y=<2>"];

const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url));
const PROGRAM_TIMEOUT_MS = 10_000;

type Run = { code: number | null; stdout: string; stderr: string };

// Starts the real program the way a user does (Node strips the TypeScript types itself), feeds stdin,
// waits at most PROGRAM_TIMEOUT_MS and always kills the child.
function runProgram(outPath: string, stdin: string): Promise<Run> {
  const child = spawn(process.execPath, [BIN, outPath], { stdio: ["pipe", "pipe", "pipe"] });
  let timer: NodeJS.Timeout | undefined;
  const done = new Promise<Run>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      stdout += d;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => {
      stderr += d;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    timer = setTimeout(
      () => reject(new Error(`program did not finish within ${PROGRAM_TIMEOUT_MS} ms; stderr: ${stderr}`)),
      PROGRAM_TIMEOUT_MS,
    );
  });
  child.stdin.on("error", () => {}); // a program that exited early shows up in `code`, not here
  child.stdin.end(stdin);
  return done.finally(() => {
    clearTimeout(timer);
    child.kill("SIGKILL");
  });
}

const cleanup: string[] = [];

// Runs the program on `stdin` into a fresh temp directory that is removed afterwards.
async function writePage(stdin: string): Promise<{ url: string; run: Run }> {
  const dir = await mkdtemp(join(tmpdir(), "links-e2e-"));
  cleanup.push(dir);
  const out = join(dir, "out.html");
  const run = await runProgram(out, stdin);
  expect(run.stderr).toBe("");
  expect(run.code).toBe(0);
  return { url: pathToFileURL(out).href, run };
}

test.afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("page lists the distinct links in order, and the console lists the same", async ({ page }) => {
  const { url, run } = await writePage(INPUT);
  expect(run.stdout).toBe(`${EXPECTED.join("\n")}\n`);

  await page.goto(url);
  const anchors = page.locator("a");
  await expect(anchors).toHaveCount(3);
  expect(await anchors.evaluateAll((els) => els.map((e) => e.getAttribute("href")))).toEqual(EXPECTED);
  expect(await anchors.allTextContents()).toEqual(EXPECTED);
});

test("empty stdin gives a page without links", async ({ page }) => {
  const { url, run } = await writePage("");
  expect(run.stdout).toBe("");

  await page.goto(url);
  await expect(page.locator("body")).toBeAttached();
  await expect(page.locator("a")).toHaveCount(0);
});

// Beyond the fixed list: markup-like and entity-like text that a browser would NOT show as given
// unless the program escapes it (the `&` and `<2>` of the fixed list happen to survive unescaped).
test("markup and entities in a link show exactly as given", async ({ page }) => {
  const nasty = `https://d.example/?q="x"&amp;<b>y</b>'`;
  const { url, run } = await writePage(`${nasty}\n`);
  expect(run.stdout).toBe(`${nasty}\n`);

  await page.goto(url);
  await expect(page.locator("a")).toHaveCount(1);
  expect(await page.locator("a").getAttribute("href")).toBe(nasty);
  expect(await page.locator("a").textContent()).toBe(nasty);
});
