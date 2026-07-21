/**
 * Sanity tests for src/lib/ratelimit/policies.ts (issue #257).
 *
 * Pins two things:
 *  - every named policy gives at least the issue's stated headroom over an
 *    authentic client's call rate (2-4x, per the issue's rationale table);
 *  - `enforcePolicy`/`enforceAdminPolicy` actually enforce the named policy
 *    end-to-end against the real memory backend (allow under, 429 over).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetMemoryStore } from "../src/lib/ratelimit";

// `@/lib/ratelimit/policies` transitively imports the real `@/lib/db` (via
// `./db.ts`'s backend-registration side effect, issue #256) — mock it out;
// the tests here only ever exercise the in-memory backend.
vi.mock("@/lib/db", () => ({ db: {} }));

import { RATE_LIMIT_POLICIES, enforceAdminPolicy, enforcePolicy } from "../src/lib/ratelimit/policies";

/** Legit client call rates per minute, from the issue's rationale table. */
const LEGIT_RATES_PER_MIN: Partial<Record<keyof typeof RATE_LIMIT_POLICIES, number>> = {
  racePoll: 9,
  raceSnapshot: 10, // "lobby ~10/min"
  queueGet: 20,
  presence: 7.5,
  admin: 2,
};

describe("RATE_LIMIT_POLICIES", () => {
  it("every policy uses a one-minute window", () => {
    for (const [key, entry] of Object.entries(RATE_LIMIT_POLICIES)) {
      expect(entry.policy.windowMs, key).toBe(60_000);
    }
  });

  it("every policy has a unique route name", () => {
    const names = Object.values(RATE_LIMIT_POLICIES).map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives at least 2x headroom over the legit client rate where specified", () => {
    for (const [key, legitRate] of Object.entries(LEGIT_RATES_PER_MIN)) {
      const entry = RATE_LIMIT_POLICIES[key as keyof typeof RATE_LIMIT_POLICIES];
      expect(entry.policy.limit, key).toBeGreaterThanOrEqual(legitRate! * 2);
    }
  });

  it("matches the issue's limit table exactly", () => {
    expect(RATE_LIMIT_POLICIES.racePoll.policy.limit).toBe(40);
    expect(RATE_LIMIT_POLICIES.raceSnapshot.policy.limit).toBe(60);
    expect(RATE_LIMIT_POLICIES.queueGet.policy.limit).toBe(60);
    expect(RATE_LIMIT_POLICIES.queueWrite.policy.limit).toBe(15);
    expect(RATE_LIMIT_POLICIES.presence.policy.limit).toBe(30);
    expect(RATE_LIMIT_POLICIES.leaderboard.policy.limit).toBe(30);
    expect(RATE_LIMIT_POLICIES.raceReady.policy.limit).toBe(20);
    expect(RATE_LIMIT_POLICIES.raceAbort.policy.limit).toBe(20);
    expect(RATE_LIMIT_POLICIES.raceDraw.policy.limit).toBe(20);
    expect(RATE_LIMIT_POLICIES.raceFilters.policy.limit).toBe(20);
    expect(RATE_LIMIT_POLICIES.livekitToken.policy.limit).toBe(20);
    expect(RATE_LIMIT_POLICIES.problemsAvailability.policy.limit).toBe(30);
    expect(RATE_LIMIT_POLICIES.admin.policy.limit).toBe(120);
  });
});

describe("enforcePolicy", () => {
  beforeEach(() => {
    _resetMemoryStore();
  });

  it("allows under the limit and blocks with 429 + Retry-After once exceeded", async () => {
    const req = new Request("http://localhost/api/x");
    const { limit } = RATE_LIMIT_POLICIES.presence.policy;

    for (let i = 0; i < limit; i++) {
      const res = await enforcePolicy(req, "presence", "user-a");
      expect(res).toBeNull();
    }

    const blocked = await enforcePolicy(req, "presence", "user-a");
    expect(blocked?.status).toBe(429);
    expect(blocked?.headers.get("Retry-After")).not.toBeNull();
    expect(await blocked?.json()).toEqual({ error: "rate_limited" });
  });

  it("keys per-user, not globally — a different user is unaffected", async () => {
    const req = new Request("http://localhost/api/x");
    const { limit } = RATE_LIMIT_POLICIES.presence.policy;

    for (let i = 0; i < limit; i++) {
      await enforcePolicy(req, "presence", "user-a");
    }
    expect(await enforcePolicy(req, "presence", "user-a")).not.toBeNull(); // blocked

    // A different user's own budget is untouched.
    expect(await enforcePolicy(req, "presence", "user-b")).toBeNull();
  });

  it("falls back to per-IP when userId is null (public routes)", async () => {
    const req = new Request("http://localhost/api/x", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });
    const { limit } = RATE_LIMIT_POLICIES.leaderboard.policy;

    for (let i = 0; i < limit; i++) {
      expect(await enforcePolicy(req, "leaderboard", null)).toBeNull();
    }
    expect((await enforcePolicy(req, "leaderboard", null))?.status).toBe(429);
  });
});

describe("enforceAdminPolicy", () => {
  beforeEach(() => {
    _resetMemoryStore();
  });

  it("enforces the admin policy per admin user id", async () => {
    const { limit } = RATE_LIMIT_POLICIES.admin.policy;

    for (let i = 0; i < limit; i++) {
      expect(await enforceAdminPolicy("admin-1")).toBeNull();
    }
    const blocked = await enforceAdminPolicy("admin-1");
    expect(blocked?.status).toBe(429);

    // A different admin's budget is unaffected.
    expect(await enforceAdminPolicy("admin-2")).toBeNull();
  });
});
