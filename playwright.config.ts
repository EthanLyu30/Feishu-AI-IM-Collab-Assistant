import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL: "http://localhost:15173",
    trace: "on-first-retry"
  },
  webServer: {
    command: "npm run dev:e2e",
    url: "http://localhost:15173",
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
