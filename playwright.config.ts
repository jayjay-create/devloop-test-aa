import { defineConfig, devices } from "@playwright/test";

// The page is checked in WebKit only (see the spec "CLI that extracts links from an HTML file").
// A test takes about a second; the program inside it is bounded separately in e2e/links.spec.ts.
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  projects: [{ name: "webkit", use: { ...devices["Desktop Safari"], browserName: "webkit" } }],
});
