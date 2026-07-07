import { describe, it, expect } from "vitest";
import {
  computeSkewMs,
  correctedNow,
  msUntilUnlock,
  nextRetryDelay,
  classifyPollResponse,
  unlockRescheduleDelay,
} from "@/lib/race/countdown";
import { UNLOCK_REFETCH_BACKOFF_MS, type RaceSnapshot } from "@/lib/types";

describe("computeSkewMs", () => {
  it("is zero when the local clock exactly matches the server clock", () => {
    const serverNowIso = "2026-01-01T00:00:00.000Z";
    const localReceiveMs = Date.parse(serverNowIso);
    expect(computeSkewMs(serverNowIso, localReceiveMs)).toBe(0);
  });

  it("is positive when the local clock runs ahead of the server", () => {
    const serverNowIso = "2026-01-01T00:00:00.000Z";
    const localReceiveMs = Date.parse(serverNowIso) + 30_000; // local is 30s ahead
    expect(computeSkewMs(serverNowIso, localReceiveMs)).toBe(30_000);
  });

  it("is negative when the local clock lags the server", () => {
    const serverNowIso = "2026-01-01T00:00:00.000Z";
    const localReceiveMs = Date.parse(serverNowIso) - 30_000; // local is 30s behind
    expect(computeSkewMs(serverNowIso, localReceiveMs)).toBe(-30_000);
  });
});

describe("correctedNow", () => {
  it("subtracts a positive skew (local ahead) from the local reading", () => {
    expect(correctedNow(30_000, 1_000_000)).toBe(970_000);
  });

  it("subtracts a negative skew (local behind), effectively adding time", () => {
    expect(correctedNow(-30_000, 1_000_000)).toBe(1_030_000);
  });

  it("defaults to Date.now() when no local reading is provided", () => {
    const before = Date.now();
    const result = correctedNow(0);
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });
});

describe("msUntilUnlock", () => {
  const startedAtIso = "2026-01-01T00:00:10.000Z";
  const startedAtMs = Date.parse(startedAtIso);

  it("is positive before unlock with no skew", () => {
    const nowMs = startedAtMs - 5_000;
    expect(msUntilUnlock(startedAtIso, 0, nowMs)).toBe(5_000);
  });

  it("is zero exactly at unlock", () => {
    expect(msUntilUnlock(startedAtIso, 0, startedAtMs)).toBe(0);
  });

  it("is negative after unlock", () => {
    const nowMs = startedAtMs + 5_000;
    expect(msUntilUnlock(startedAtIso, 0, nowMs)).toBe(-5_000);
  });

  it("matches server phase despite +30s client skew (local clock fast)", () => {
    // Local clock reads 30s ahead of the server. Raw Date.now() comparison
    // would think the race unlocked 30s early; skew correction must not.
    const skewMs = 30_000;
    const localNowMs = startedAtMs; // local clock says "now == startedAt"
    // Corrected time is actually startedAtMs - 30_000, so 30s remain.
    expect(msUntilUnlock(startedAtIso, skewMs, localNowMs)).toBe(30_000);
  });

  it("matches server phase despite -30s client skew (local clock slow)", () => {
    const skewMs = -30_000;
    const localNowMs = startedAtMs; // local clock says "now == startedAt"
    // Corrected time is actually startedAtMs + 30_000, so unlock is 30s past.
    expect(msUntilUnlock(startedAtIso, skewMs, localNowMs)).toBe(-30_000);
  });
});

describe("nextRetryDelay", () => {
  it("returns the configured backoff sequence in order", () => {
    UNLOCK_REFETCH_BACKOFF_MS.forEach((delay, attempt) => {
      expect(nextRetryDelay(attempt)).toBe(delay);
    });
  });

  it("holds at the last configured delay once attempts exceed the table", () => {
    const last = UNLOCK_REFETCH_BACKOFF_MS[UNLOCK_REFETCH_BACKOFF_MS.length - 1];
    expect(nextRetryDelay(UNLOCK_REFETCH_BACKOFF_MS.length)).toBe(last);
    expect(nextRetryDelay(UNLOCK_REFETCH_BACKOFF_MS.length + 10)).toBe(last);
  });

  it("clamps negative attempt numbers to the first delay", () => {
    expect(nextRetryDelay(-1)).toBe(UNLOCK_REFETCH_BACKOFF_MS[0]);
  });
});

describe("unlockRescheduleDelay", () => {
  const startedAtIso = "2026-01-01T00:00:10.000Z";
  const startedAtMs = Date.parse(startedAtIso);

  it("returns null once the initial unlock attempt has already fired", () => {
    // No matter what the skew says, a fired initial attempt must not be
    // rearmed — retry cadence beyond that point is attempt/backoff-based,
    // not skew-based (issue #62's invariant).
    expect(unlockRescheduleDelay(startedAtIso, 30_000, true, startedAtMs)).toBeNull();
    expect(unlockRescheduleDelay(startedAtIso, -30_000, true, startedAtMs - 5_000)).toBeNull();
  });

  it("recomputes a shorter delay when an inflated skew is corrected downward", () => {
    // Simulates the SSR-hydration bug: skew was inflated by page-delivery
    // latency, so the originally-scheduled delay was too long. Once skew is
    // corrected (smaller), rescheduling must shrink the remaining wait.
    const nowMs = startedAtMs - 20_000; // 20s of "real" time before unlock
    const inflatedSkew = 15_000; // stale reading baked in ~15s of latency
    const correctedSkew = 2_000; // true skew after the mount refetch heals it

    const staleDelay = msUntilUnlock(startedAtIso, inflatedSkew, nowMs);
    const rescheduled = unlockRescheduleDelay(startedAtIso, correctedSkew, false, nowMs);

    expect(rescheduled).not.toBeNull();
    expect(rescheduled as number).toBeLessThan(staleDelay);
    expect(rescheduled).toBe(msUntilUnlock(startedAtIso, correctedSkew, nowMs));
  });

  it("never returns a negative delay — a correction can rearm at most to 'now', never early", () => {
    const nowMs = startedAtMs + 1_000; // already past unlock per corrected skew
    expect(unlockRescheduleDelay(startedAtIso, 0, false, nowMs)).toBe(0);
  });

  it("matches msUntilUnlock (floored at 0) when the initial attempt hasn't fired", () => {
    const nowMs = startedAtMs - 8_000;
    const skewMs = 3_000;
    expect(unlockRescheduleDelay(startedAtIso, skewMs, false, nowMs)).toBe(
      Math.max(0, msUntilUnlock(startedAtIso, skewMs, nowMs)),
    );
  });
});

describe("classifyPollResponse", () => {
  const snapshot = { status: "active" } as unknown as RaceSnapshot;

  it("classifies a real snapshot by its string status field", () => {
    expect(classifyPollResponse(snapshot)).toEqual({ kind: "snapshot", snapshot });
  });

  it("classifies the DB-mutex skipped shape", () => {
    expect(classifyPollResponse({ skipped: true })).toEqual({ kind: "skipped" });
  });

  it("treats null as unknown", () => {
    expect(classifyPollResponse(null)).toEqual({ kind: "unknown" });
  });

  it("treats a non-object as unknown", () => {
    expect(classifyPollResponse("not an object")).toEqual({ kind: "unknown" });
  });

  it("treats an object with neither field as unknown", () => {
    expect(classifyPollResponse({ foo: "bar" })).toEqual({ kind: "unknown" });
  });

  it("treats skipped: false without a status as unknown, not skipped", () => {
    expect(classifyPollResponse({ skipped: false })).toEqual({ kind: "unknown" });
  });
});
