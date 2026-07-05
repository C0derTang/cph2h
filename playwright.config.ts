import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright e2e smoke test config (issue #18).
 *
 * NOT part of the CI gate — `.github/workflows/ci.yml` only runs
 * lint/typecheck/vitest. This config is invoked separately via
 * `pnpm test:e2e` against a real, already-running app (`pnpm dev` or a
 * preview deployment). See the header comment in `e2e/race.spec.ts` for the
 * full list of required environment variables (Clerk test-instance keys,
 * DATABASE_URL, two seeded test users, RACE_TEST_MODE=1).
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // Two browser contexts drive one shared race at a time — running specs in
  // parallel would mean racing DB rows/challenge tokens against each other.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  projects: [
    {
      // Fetches a Clerk Testing Token once per run (see e2e/global.setup.ts)
      // so the `chromium` project's tests can bypass Clerk's bot detection.
      name: "setup",
      testMatch: /global\.setup\.ts/,
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
});
