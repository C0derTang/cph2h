/**
 * Tests for src/lib/cf/cheaters.ts (issue #184).
 *
 * `parseCheaterList`/`isKnownCheater` are pure and tested directly.
 * `getCheaterSet` owns a module-level cache + `fetch`, so each test that
 * exercises it calls `vi.resetModules()` and re-imports the module fresh —
 * that's the only way to get a clean cache per test without exposing a
 * test-only reset hook from the module itself.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isKnownCheater, parseCheaterList } from "@/lib/cf/cheaters";

describe("parseCheaterList", () => {
  it("lowercases every handle and returns a Set", () => {
    const set = parseCheaterList({
      cheaters: ["Tourist", "PETR", "benq"],
      lastExportTime: "2024-01-01T00:00:00Z",
    });
    expect(set).toEqual(new Set(["tourist", "petr", "benq"]));
  });

  it("returns null for a non-object payload", () => {
    expect(parseCheaterList(null)).toBeNull();
    expect(parseCheaterList("not json")).toBeNull();
    expect(parseCheaterList(42)).toBeNull();
    expect(parseCheaterList(undefined)).toBeNull();
  });

  it("returns null when cheaters is missing or not an array", () => {
    expect(parseCheaterList({ lastExportTime: "x" })).toBeNull();
    expect(parseCheaterList({ cheaters: "tourist", lastExportTime: "x" })).toBeNull();
  });

  it("returns null when lastExportTime is missing or not a string", () => {
    expect(parseCheaterList({ cheaters: ["tourist"] })).toBeNull();
    expect(parseCheaterList({ cheaters: ["tourist"], lastExportTime: 123 })).toBeNull();
  });

  it("returns null when any entry in cheaters is not a string", () => {
    expect(
      parseCheaterList({ cheaters: ["tourist", 42], lastExportTime: "x" }),
    ).toBeNull();
  });

  it("accepts an empty cheaters array", () => {
    expect(parseCheaterList({ cheaters: [], lastExportTime: "x" })).toEqual(new Set());
  });
});

describe("isKnownCheater", () => {
  const set = new Set(["tourist", "petr"]);

  it("matches case-insensitively", () => {
    expect(isKnownCheater("Tourist", set)).toBe(true);
    expect(isKnownCheater("TOURIST", set)).toBe(true);
    expect(isKnownCheater("tourist", set)).toBe(true);
  });

  it("returns false for a handle not on the list", () => {
    expect(isKnownCheater("benq", set)).toBe(false);
  });
});

describe("getCheaterSet", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches and returns the parsed set on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ cheaters: ["Tourist"], lastExportTime: "x" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getCheaterSet } = await import("@/lib/cf/cheaters");
    const set = await getCheaterSet();

    expect(set).toEqual(new Set(["tourist"]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails open (returns null) when the fetch is not ok", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const { getCheaterSet } = await import("@/lib/cf/cheaters");
    const set = await getCheaterSet();

    expect(set).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("fails open (returns null) when fetch throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const { getCheaterSet } = await import("@/lib/cf/cheaters");
    const set = await getCheaterSet();

    expect(set).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("fails open (returns null) when the payload is malformed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ not: "the right shape" }) }),
    );

    const { getCheaterSet } = await import("@/lib/cf/cheaters");
    const set = await getCheaterSet();

    expect(set).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("caches a successful fetch — a second call within the TTL does not refetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ cheaters: ["tourist"], lastExportTime: "x" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { getCheaterSet } = await import("@/lib/cf/cheaters");
    await getCheaterSet();
    await getCheaterSet();
    await getCheaterSet();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failure — the next call retries the fetch", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    const { getCheaterSet } = await import("@/lib/cf/cheaters");
    await getCheaterSet();
    await getCheaterSet();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refetches once the TTL expires", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ cheaters: ["tourist"], lastExportTime: "x" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const { getCheaterSet, CHEATER_LIST_TTL_MS } = await import("@/lib/cf/cheaters");
    await getCheaterSet();
    vi.advanceTimersByTime(CHEATER_LIST_TTL_MS + 1);
    await getCheaterSet();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
