import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The limiter installs itself into the CF client on import and keeps its DB
// seam in module-level state, so each test re-imports fresh after
// vi.resetModules() and injects fakes via setLimiterDeps — no real DB.
async function importLimiter() {
  return await import("@/lib/cf/limiter");
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("computeSlotWait", () => {
  it("returns 0 for a slot at or before the DB clock", async () => {
    const { computeSlotWait } = await importLimiter();
    expect(computeSlotWait(1000, 1000, 15_000)).toEqual({ waitMs: 0, overCap: false });
    expect(computeSlotWait(500, 1000, 15_000)).toEqual({ waitMs: 0, overCap: false });
  });

  it("returns the future delta and flags over-cap waits", async () => {
    const { computeSlotWait } = await importLimiter();
    expect(computeSlotWait(3000, 1000, 15_000)).toEqual({ waitMs: 2000, overCap: false });
    // exactly at the cap is not over
    expect(computeSlotWait(16_000, 1000, 15_000)).toEqual({ waitMs: 15_000, overCap: false });
    // one ms over the cap trips backpressure
    expect(computeSlotWait(16_001, 1000, 15_000)).toEqual({ waitMs: 15_001, overCap: true });
  });
});

describe("claimCfSlot", () => {
  it("resolves (void) after sleeping the claimed wait, using the injected claimFn", async () => {
    vi.useFakeTimers();
    const { claimCfSlot, setLimiterDeps } = await importLimiter();
    const claim = vi.fn().mockResolvedValue({ slotAtMs: 5000, dbNowMs: 3000 });
    const giveBack = vi.fn().mockResolvedValue(undefined);
    setLimiterDeps({ claim, giveBack });

    const pending = claimCfSlot();
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    // 2000ms wait (5000 - 3000): not resolved before it elapses.
    await vi.advanceTimersByTimeAsync(1999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toBeUndefined();
    expect(claim).toHaveBeenCalledTimes(1);
    expect(giveBack).not.toHaveBeenCalled();
  });

  it("resolves immediately (no sleep) when the slot is already due", async () => {
    const { claimCfSlot, setLimiterDeps } = await importLimiter();
    const claim = vi.fn().mockResolvedValue({ slotAtMs: 1000, dbNowMs: 1000 });
    setLimiterDeps({ claim });

    await expect(claimCfSlot()).resolves.toBeUndefined();
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("gives the slot back and throws CfBackpressureError past the cap", async () => {
    const { claimCfSlot, setLimiterDeps, CfBackpressureError, MAX_SLOT_WAIT_MS } =
      await importLimiter();
    const claim = vi
      .fn()
      .mockResolvedValue({ slotAtMs: MAX_SLOT_WAIT_MS + 5000, dbNowMs: 0 });
    const giveBack = vi.fn().mockResolvedValue(undefined);
    setLimiterDeps({ claim, giveBack });

    await expect(claimCfSlot()).rejects.toBeInstanceOf(CfBackpressureError);
    expect(giveBack).toHaveBeenCalledTimes(1);
  });

  it("fails open (fallback: true) when the claim query throws (DB down)", async () => {
    const { claimCfSlot, setLimiterDeps } = await importLimiter();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const claim = vi.fn().mockRejectedValue(new Error("connection refused"));
    const giveBack = vi.fn().mockResolvedValue(undefined);
    setLimiterDeps({ claim, giveBack });

    await expect(claimCfSlot()).resolves.toEqual({ fallback: true });
    expect(giveBack).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("aborting during the wait gives the slot back and rethrows the abort", async () => {
    vi.useFakeTimers();
    const { claimCfSlot, setLimiterDeps } = await importLimiter();
    const claim = vi.fn().mockResolvedValue({ slotAtMs: 10_000, dbNowMs: 0 });
    const giveBack = vi.fn().mockResolvedValue(undefined);
    setLimiterDeps({ claim, giveBack });

    const controller = new AbortController();
    const pending = claimCfSlot({ signal: controller.signal });
    const settled = expect(pending).rejects.toMatchObject({ name: "AbortError" });

    // Mid-wait (well before the 10s slot): abort.
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();

    await settled;
    expect(giveBack).toHaveBeenCalledTimes(1);
  });

  it("rejects immediately if the signal is already aborted (no claim, no give-back)", async () => {
    const { claimCfSlot, setLimiterDeps } = await importLimiter();
    const claim = vi.fn().mockResolvedValue({ slotAtMs: 0, dbNowMs: 0 });
    const giveBack = vi.fn().mockResolvedValue(undefined);
    setLimiterDeps({ claim, giveBack });

    const controller = new AbortController();
    controller.abort();
    await expect(claimCfSlot({ signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(claim).not.toHaveBeenCalled();
    expect(giveBack).not.toHaveBeenCalled();
  });

  it("seeds the row then retries the claim once on a 0-row (null) claim", async () => {
    const { claimCfSlot, setLimiterDeps } = await importLimiter();
    const claim = vi
      .fn()
      .mockResolvedValueOnce(null) // row missing
      .mockResolvedValueOnce({ slotAtMs: 1000, dbNowMs: 1000 }); // after seed
    const seed = vi.fn().mockResolvedValue(undefined);
    setLimiterDeps({ claim, seed });

    await expect(claimCfSlot()).resolves.toBeUndefined();
    expect(seed).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it("fails open when the row is still missing after a seed + retry", async () => {
    const { claimCfSlot, setLimiterDeps } = await importLimiter();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const claim = vi.fn().mockResolvedValue(null); // always 0 rows
    const seed = vi.fn().mockResolvedValue(undefined);
    setLimiterDeps({ claim, seed });

    await expect(claimCfSlot()).resolves.toEqual({ fallback: true });
    expect(seed).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it("respects a per-call maxWaitMs override for backpressure", async () => {
    const { claimCfSlot, setLimiterDeps, CfBackpressureError } = await importLimiter();
    const claim = vi.fn().mockResolvedValue({ slotAtMs: 6000, dbNowMs: 0 });
    const giveBack = vi.fn().mockResolvedValue(undefined);
    setLimiterDeps({ claim, giveBack });

    // 6000ms wait is under the 15s default but over a 5s override.
    await expect(claimCfSlot({ maxWaitMs: 5000 })).rejects.toBeInstanceOf(
      CfBackpressureError,
    );
    expect(giveBack).toHaveBeenCalledTimes(1);
  });
});
