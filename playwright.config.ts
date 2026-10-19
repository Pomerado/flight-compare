import { defineConfig } from "@playwright/test";

// The app is driven through Playwright's Electron support against a local fake Pomerado API.
// Each test launches its own app with a fresh profile and its own fake API.
export default defineConfig({
  testDir: "test/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 2,
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
});
