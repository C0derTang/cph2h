import { clerk } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { RaceSnapshot } from "@/lib/types";
import { getUserById, seedRacer } from "./support/seed";

/**
 * Full race-flow smoke test (issue #18).
 *
 * Two Clerk-authenticated users race each other end to end: A creates a
 * challenge, B joins, both ready up, the countdown runs out, the problem +
 * samples render for both, and `POST /api/dev/inject-verdict` (issue #15's
 * `RACE_TEST_MODE` shortcut) stands in for a real Codeforces
 * submission/poll cycle so the test never touches CF or Piston. Finally both
 * clients' result cards, the players' Elo, and the leaderboard/dashboard are
 * asserted to reflect the finished race.
 *
 * NOT part of the CI gate (`.github/workflows/ci.yml` only runs
 * lint/typecheck/vitest) — real network hops, timers, and two live browser
 * contexts make this flaky by nature. Run it manually via `pnpm test:e2e`
 * against a running app.
 *
 * Required environment:
 *   E2E_BASE_URL                 Base URL of the running app under test.
 *                                 Default: http://localhost:3000
 *   DATABASE_URL                 Same Postgres instance the app under test
 *                                 uses — e2e/support/seed.ts writes `users`
 *                                 rows directly.
 *   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY
 *                                 Same Clerk *development* instance the app
 *                                 under test uses (already required to run
 *                                 the app at all).
 *   E2E_USER_A_EMAIL             Email of an existing Clerk user (player A).
 *   E2E_USER_B_EMAIL             Email of an existing Clerk user (player B).
 *                                 Both accounts must already exist in that
 *                                 Clerk instance — Clerk's `+clerk_test`
 *                                 convention keeps them obviously test-only,
 *                                 e.g. `racer-a+clerk_test@example.com`.
 *   RACE_TEST_MODE=1              Enables POST /api/dev/inject-verdict.
 *
 * The problem+samples assertions additionally need at least one row in the
 * `problems` table whose rating lands near the picker's target for two
 * unrated players (1200 — see `targetRating` in
 * src/lib/cf/problem-picker.ts). `pnpm exec tsx scripts/seed.ts` seeds a
 * compatible pool against a fresh dev database; without it the race still
 * starts and finishes correctly (problem selection degrades to `null`), but
 * those two assertions will need loosening for that environment.
 *
 * A live run was NOT executed as part of authoring this test — no running
 * app/DB/Clerk test users are available in this worktree. It is written to
 * be correct and runnable; verifying it end-to-end is deferred to master's
 * own environment.
 */

const USER_A = {
  email: process.env.E2E_USER_A_EMAIL ?? "",
  username: "e2e-racer-a",
  cfHandle: "e2e_racer_a",
  elo: 1200,
};
const USER_B = {
  email: process.env.E2E_USER_B_EMAIL ?? "",
  username: "e2e-racer-b",
  cfHandle: "e2e_racer_b",
  elo: 1200,
};

async function signIn(page: Page, emailAddress: string): Promise<void> {
  // Navigate to an unprotected page first so Clerk's client JS loads, per
  // https://clerk.com/docs/testing/playwright/test-helpers.
  await page.goto("/");
  await clerk.signIn({ page, emailAddress });
}

test("challenge -> ready -> active -> verdict -> result -> elo", async ({
  browser,
}) => {
  test.skip(
    !USER_A.email || !USER_B.email,
    "Set E2E_USER_A_EMAIL and E2E_USER_B_EMAIL to run this suite.",
  );
  test.setTimeout(180_000);

  const racerA = await seedRacer(USER_A);
  const racerB = await seedRacer(USER_B);

  // The compete gate (issue #100) requires a granted, live microphone before
  // "I'm ready" is enabled — grant it up front so this flow-smoke test isn't
  // also asserting the (separately unit-tested) gate. Chromium serves fake
  // media devices in this mode, so the getUserMedia probe resolves live.
  const contextA = await browser.newContext({ permissions: ["microphone"] });
  const contextB = await browser.newContext({ permissions: ["microphone"] });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await signIn(pageA, USER_A.email);
    await signIn(pageB, USER_B.email);

    // --- A creates a challenge -----------------------------------------------
    await pageA.goto("/challenge/new");
    await pageA.getByRole("button", { name: "Create challenge" }).click();

    const joinUrl = await pageA.locator("code").textContent();
    if (!joinUrl) throw new Error("Could not read the challenge join URL.");
    const joinPath = new URL(joinUrl).pathname;

    // "Go to race room" renders as a plain <a> (Button rendered via a Link),
    // so select by anchor + text rather than an assumed ARIA role.
    const goToRoom = pageA.locator("a", { hasText: "Go to race room" });
    const raceHref = await goToRoom.getAttribute("href");
    if (!raceHref) throw new Error("Could not read the race room link.");
    const raceId = raceHref.split("/").filter(Boolean).pop();
    if (!raceId) throw new Error(`Could not parse a raceId from "${raceHref}".`);

    await goToRoom.click();
    await expect(pageA.getByTestId("race-status")).toHaveText("pending");

    // --- B joins ---------------------------------------------------------------
    await pageB.goto(joinPath);
    await pageB.getByRole("button", { name: "Join race" }).click();
    await expect(pageB).toHaveURL(new RegExp(`/race/${raceId}$`));
    await expect(pageB.getByTestId("race-status")).toHaveText("ready");

    // A's lobby only learns about the join on its next poll
    // (CLIENT_POLL_INTERVAL_MS, currently 6s) — give it room.
    await expect(pageA.getByTestId("race-status")).toHaveText("ready", {
      timeout: 20_000,
    });

    // --- Both ready up -----------------------------------------------------------
    await pageA.getByRole("button", { name: "I'm ready" }).click();
    await pageB.getByRole("button", { name: "I'm ready" }).click();

    // --- Countdown -> active ------------------------------------------------------
    await expect(pageA.getByTestId("race-room")).toBeVisible({ timeout: 20_000 });
    await expect(pageB.getByTestId("race-room")).toBeVisible({ timeout: 20_000 });
    await expect(pageA.getByTestId("race-hud")).toBeVisible();
    await expect(pageB.getByTestId("race-hud")).toBeVisible();

    // The pre-race countdown (COUNTDOWN_SEC, currently 10s) flips to a live
    // timer once the race is actually underway.
    await expect(pageA.getByTestId("race-timer")).toBeVisible({ timeout: 20_000 });
    await expect(pageB.getByTestId("race-timer")).toBeVisible({ timeout: 20_000 });

    // Problem + samples render for both. See the module doc comment above
    // for the `problems` table fixture this depends on.
    await expect(pageA.getByTestId("problem-title")).not.toHaveText(
      "Problem locked",
      { timeout: 20_000 },
    );
    await expect(pageB.getByTestId("problem-title")).not.toHaveText(
      "Problem locked",
      { timeout: 20_000 },
    );
    await expect(pageA.locator("pre").first()).toBeVisible();
    await expect(pageB.locator("pre").first()).toBeVisible();

    // --- Inject an OK verdict for A (issue #15 RACE_TEST_MODE shortcut) --------
    const injectRes = await pageA.request.post("/api/dev/inject-verdict", {
      data: { raceId, userId: racerA.id, verdict: "OK" },
    });
    expect(injectRes.ok(), await injectRes.text()).toBeTruthy();
    const finished = (await injectRes.json()) as RaceSnapshot;
    expect(finished.status).toBe("finished");
    expect(finished.winnerId).toBe(racerA.id);

    // --- Both clients reflect the result ----------------------------------------
    await expect(pageA.getByTestId("result-card")).toBeVisible({ timeout: 20_000 });
    await expect(pageB.getByTestId("result-card")).toBeVisible({ timeout: 20_000 });
    await expect(pageA.getByTestId("result-heading")).toHaveText("Bodied.");
    await expect(pageB.getByTestId("result-heading")).toHaveText("You got bodied.");
    await expect(pageA.getByTestId("rematch-btn")).toBeVisible();

    // --- Elo moved in the right direction ---------------------------------------
    const updatedA = await getUserById(racerA.id);
    const updatedB = await getUserById(racerB.id);
    if (!updatedA || !updatedB) {
      throw new Error("Seeded racers vanished mid-test.");
    }
    expect(updatedA.elo).toBeGreaterThan(USER_A.elo);
    expect(updatedB.elo).toBeLessThan(USER_B.elo);

    // --- Leaderboard + dashboard reflect the new Elo ----------------------------
    await pageA.goto("/dashboard");
    await expect(
      pageA
        .locator("p", { hasText: "Current Elo" })
        .locator("xpath=following-sibling::p[1]"),
    ).toHaveText(String(updatedA.elo));

    await pageA.goto("/leaderboard");
    await expect(
      pageA.locator("tr", { hasText: USER_A.username }),
    ).toContainText(String(updatedA.elo));
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
