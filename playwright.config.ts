import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  projects: [{ name: "webkit", use: { ...devices["Desktop Safari"] } }],
});
