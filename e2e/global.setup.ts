import { clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";

/**
 * One-time Clerk bot-protection bypass setup (issue #18).
 *
 * Fetches a Clerk Testing Token via the Backend API — needs `CLERK_SECRET_KEY`
 * plus a publishable key (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, already
 * required to run the app at all) — and stashes it on `process.env` for
 * every test in the `chromium` project (see the `dependencies: ["setup"]`
 * wiring in playwright.config.ts).
 *
 * Must run serially — see https://playwright.dev/docs/test-parallel.
 */
setup.describe.configure({ mode: "serial" });

setup("clerk global setup", async () => {
  await clerkSetup();
});
