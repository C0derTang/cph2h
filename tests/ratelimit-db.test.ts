/**
 * Tests for src/lib/ratelimit/db.ts (issue #256).
 *
 * `checkDb` is exercised against a mocked `db.execute` so the row
 * interpretation (allowed, blocked, window-reset, fail-open on a missing
 * row / a thrown error) is covered without a real database. A separate
 * `enforceRateLimit`-level test proves the module's module-scope
 * `registerDbBackend(checkDb)` call actually wires it up as the "db"
 * backend (the wave-10 seam from #253) — importing `./db` is what does the
 * registration, mirroring how `./policies.ts` (and thus every enforced
 * route) pulls it in.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RateLimitPolicy } from "@/lib/ratelimit/policy";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { execute } }));

import { checkDb } from "@/lib/ratelimit/db";
import { enforceRateLimit } from "@/lib/ratelimit";

const POLICY: RateLimitPolicy = { limit: 5, windowMs: 60_000 };

beforeEach(() => {
  execute.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkDb", () => {
  it("allows and reports remaining when the row's count is within the limit", async () => {
    const windowStart = new Date("2024-01-01T00:00:00.000Z");
    const dbNow = new Date("2024-01-01T00:00:10.000Z");
    execute.mockResolvedValueOnce({
      rows: [{ count: 3, window_start: windowStart.toISOString(), db_now: dbNow.toISOString() }],
    });

    const result = await checkDb("k", POLICY);

    expect(result).toEqual({
      allowed: true,
      retryAfterMs: 0,
      remaining: 2,
      nextState: { windowStartMs: windowStart.getTime(), count: 3 },
    });
  });

  it("blocks once the row's count exceeds the limit, with retryAfterMs to window end", async () => {
    const windowStart = new Date("2024-01-01T00:00:00.000Z");
    const dbNow = new Date("2024-01-01T00:00:50.000Z"); // 50s into a 60s window
    execute.mockResolvedValueOnce({
      rows: [{ count: 6, window_start: windowStart.toISOString(), db_now: dbNow.toISOString() }],
    });

    const result = await checkDb("k", POLICY);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBe(10_000); // 60_000 - 50_000
    expect(result.nextState).toEqual({ windowStartMs: windowStart.getTime(), count: 6 });
  });

  it("interprets a reset window (fresh window_start from the CASE branch) as a fresh count", async () => {
    // Simulates the upsert's CASE branch firing: the DB itself decided the
    // prior window had elapsed and started a new one at count 1.
    const freshStart = new Date("2024-01-01T01:00:00.000Z");
    execute.mockResolvedValueOnce({
      rows: [{ count: 1, window_start: freshStart.toISOString(), db_now: freshStart.toISOString() }],
    });

    const result = await checkDb("k", POLICY);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(result.nextState).toEqual({ windowStartMs: freshStart.getTime(), count: 1 });
  });

  it("accepts Date objects for window_start/db_now, not just strings", async () => {
    const windowStart = new Date("2024-01-01T00:00:00.000Z");
    execute.mockResolvedValueOnce({
      rows: [{ count: 1, window_start: windowStart, db_now: windowStart }],
    });

    const result = await checkDb("k", POLICY);

    expect(result.nextState.windowStartMs).toBe(windowStart.getTime());
  });

  it("clamps retryAfterMs at 0 (never negative) if db_now is somehow before the window end check", async () => {
    const windowStart = new Date("2024-01-01T00:00:00.000Z");
    // count over the limit, but db_now equals window_start (edge case) —
    // retryAfterMs should still be a sane non-negative number.
    execute.mockResolvedValueOnce({
      rows: [{ count: 10, window_start: windowStart.toISOString(), db_now: windowStart.toISOString() }],
    });

    const result = await checkDb("k", POLICY);

    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThanOrEqual(0);
  });

  it("fails open (allowed) and warns when the upsert returns no row", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    execute.mockResolvedValueOnce({ rows: [] });

    const result = await checkDb("k", POLICY);

    expect(result.allowed).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("propagates a thrown db error so the caller (enforceRateLimit) can fail open", async () => {
    execute.mockRejectedValueOnce(new Error("connection reset"));

    await expect(checkDb("k", POLICY)).rejects.toThrow("connection reset");
  });

  it("issues a single upsert statement scoped to api_rate_limits with the caller's key", async () => {
    execute.mockResolvedValueOnce({
      rows: [{ count: 1, window_start: new Date().toISOString(), db_now: new Date().toISOString() }],
    });

    await checkDb("races_create:user:abc-123", POLICY);

    expect(execute).toHaveBeenCalledTimes(1);
    const text = JSON.stringify(execute.mock.calls[0][0]);
    expect(text).toContain("api_rate_limits");
    expect(text).toContain("ON CONFLICT");
    expect(text).toContain("RETURNING");
    expect(text).toContain("races_create:user:abc-123");
    expect(text).toContain("60000"); // policy.windowMs bound param
  });
});

describe("checkDb wired as the enforceRateLimit \"db\" backend", () => {
  // Importing "@/lib/ratelimit/db" above already registered `checkDb` at
  // module load (that registration is the whole point of the module) — no
  // reset here, since these tests exist to prove that registration sticks
  // and routes needn't re-register per call.

  it("importing ./db registers checkDb, so backend: \"db\" hits the real upsert path", async () => {
    execute.mockResolvedValueOnce({
      rows: [{ count: 1, window_start: new Date().toISOString(), db_now: new Date().toISOString() }],
    });

    const req = new Request("http://localhost/api/x");
    const res = await enforceRateLimit(req, "wired-key", {
      name: "t",
      policy: POLICY,
      backend: "db",
    });

    expect(res).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("fails open through enforceRateLimit when the db upsert throws", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    execute.mockRejectedValueOnce(new Error("db down"));

    const req = new Request("http://localhost/api/x");
    const res = await enforceRateLimit(req, "wired-key-2", {
      name: "t",
      policy: POLICY,
      backend: "db",
    });

    expect(res).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });
});
