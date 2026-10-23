import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const INPUT = "https://a.example/\nrel/b.html\nhttps://a.example/\nhttps://c.example/?x=1&y=<2>\n";
const EXPECTED = ["https://a.example/", "rel/b.html", "https://c.example/?x=1&y=<2>"];

// Starts the real program, feeds stdin, waits at most 10 s, always kills the child.
function runProgram(outPath: string, stdin: string): Promise<{ code: number | null; stdout: string }> {
  const child = spawn("node", ["src/bin.ts", outPath], { stdio: ["pipe", "pipe", "inherit"] });
  let timer: NodeJS.Timeout | undefined;
  const done = new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      stdout += d;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout }));
    timer = setTimeout(() => reject(new Error("program did not finish within 10 s")), 10_000);
  });
  child.stdin.end(stdin);
  return done.finally(() => {
    clearTimeout(timer);
    child.kill();
  });
}

test("page lists the distinct links in order, escaped, and the console matches", async ({ page }) => {
  const dir = await mkdtemp(join(tmpdir(), "links-e2e-"));
  try {
    const out = join(dir, "out.html");
    const { code, stdout } = await runProgram(out, INPUT);
    expect(code).toBe(0);
    expect(stdout).toBe(`${EXPECTED.join("\n")}\n`);

    await page.goto(`file://${out}`);
    const anchors = page.locator("a");
    await expect(anchors).toHaveCount(3);
    expect(await anchors.evaluateAll((els) => els.map((e) => e.getAttribute("href")))).toEqual(EXPECTED);
    expect(await anchors.allTextContents()).toEqual(EXPECTED);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("empty stdin gives a page without links", async ({ page }) => {
  const dir = await mkdtemp(join(tmpdir(), "links-e2e-"));
  try {
    const out = join(dir, "out.html");
    const { code, stdout } = await runProgram(out, "");
    expect(code).toBe(0);
    expect(stdout).toBe("");

    await page.goto(`file://${out}`);
    await expect(page.locator("body")).toBeAttached();
    await expect(page.locator("a")).toHaveCount(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Beyond the fixed list: markup-like and entity-like text that a browser would NOT show as given
// unless the program escapes it (the `&` and `<2>` of the fixed list happen to survive unescaped).
test("markup and entities in a link show exactly as given", async ({ page }) => {
  const nasty = `https://d.example/?q="x"&amp;<b>y</b>'`;
  const dir = await mkdtemp(join(tmpdir(), "links-e2e-"));
  try {
    const out = join(dir, "out.html");
    await runProgram(out, `${nasty}\n`);

    await page.goto(`file://${out}`);
    await expect(page.locator("a")).toHaveCount(1);
    expect(await page.locator("a").getAttribute("href")).toBe(nasty);
    expect(await page.locator("a").textContent()).toBe(nasty);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
