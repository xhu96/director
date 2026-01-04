import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for Director E2E tests.
 *
 * These tests verify end-to-end user flows through the Studio UI.
 * They require the gateway and studio to be running:
 *
 *   bun run serve      # Start gateway on port 3673
 *   bun run studio     # Start studio on port 3000
 *   bun run test:e2e   # Run E2E tests
 *
 * For CI, use the webServer config to auto-start services.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",

  use: {
    // Base URL for all page.goto() calls
    baseURL: "http://localhost:3000",

    // Capture screenshots on failure
    screenshot: "only-on-failure",

    // Record video on first retry
    video: "on-first-retry",

    // Trace on first retry for debugging
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // Uncomment for cross-browser testing
    // {
    //   name: "firefox",
    //   use: { ...devices["Desktop Firefox"] },
    // },
    // {
    //   name: "webkit",
    //   use: { ...devices["Desktop Safari"] },
    // },
  ],

  // Auto-start services for CI
  // Uncomment when ready for CI integration
  // webServer: [
  //   {
  //     command: "bun run serve",
  //     url: "http://localhost:3673/api/health",
  //     reuseExistingServer: !process.env.CI,
  //   },
  //   {
  //     command: "bun run studio",
  //     url: "http://localhost:3000",
  //     reuseExistingServer: !process.env.CI,
  //   },
  // ],
});
