/**
 * Tests for src/lib/ratelimit/{policy,memory,index}.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyFixedWindow,
  type RateLimitPolicy,
  type WindowState,
} from "../src/lib/ratelimit/policy";
import {
  _memoryStoreSize,
  _resetMemoryStore,
  checkMemory,
} from "../src/lib/ratelimit/memory";
import {
  _resetDbBackend,
  enforceRateLimit,
  rateLimitKey,
  registerDbBackend,
} from "../src/lib/ratelimit";

describe("applyFixedWindow", () => {
  const policy: RateLimitPolicy = { limit: 3, windowMs: 1000 };

  it("starts a fresh window with count 1 when state is null", () => {
    const result = applyFixedWindow(null, 0, policy);
    expect(result).toEqual({
      allowed: true,
      retryAfterMs: 0,
      remaining: 2,
      nextState: { windowStartMs: 0, count: 1 },
    });
  });

  it("increments within the window and reports remaining", () => {
    const state: WindowState = { windowStartMs: 0, count: 1 };
    const result = applyFixedWindow(state, 500, policy);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
    expect(result.retryAfterMs).toBe(0);
    expect(result.nextState).toEqual({ windowStartMs: 0, count: 2 });
  });

  it("blocks once count exceeds the limit, with retryAfterMs to window end", () => {
    const state: WindowState = { windowStartMs: 0, count: 3 };
    const result = applyFixedWindow(state, 700, policy);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBe(300); // 0 + 1000 - 700
    expect(result.nextState).toEqual({ windowStartMs: 0, count: 4 });
  });

  it("resets exactly at the windowMs boundary (nowMs === windowStartMs + windowMs)", () => {
    const state: WindowState = { windowStartMs: 0, count: 3 };
    const result = applyFixedWindow(state, 1000, policy);
    expect(result.allowed).toBe(true);
    expect(result.retryAfterMs).toBe(0);
    expect(result.nextState).toEqual({ windowStartMs: 1000, count: 1 });
  });

  it("does not reset one ms before the boundary", () => {
    const state: WindowState = { windowStartMs: 0, count: 3 };
    const result = applyFixedWindow(state, 999, policy);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBe(1);
    expect(result.nextState).toEqual({ windowStartMs: 0, count: 4 });
  });
});

describe("checkMemory", () => {
  beforeEach(() => {
    _resetMemoryStore();
  });

  it("isolates counts per key", () => {
    const policy: RateLimitPolicy = { limit: 1, windowMs: 1000 };

    expect(checkMemory("a", policy, 0).allowed).toBe(true);
    expect(checkMemory("b", policy, 0).allowed).toBe(true);

    // a's second hit in the same window is over its own limit...
    expect(checkMemory("a", policy, 0).allowed).toBe(false);
    // ...independently of b, which hasn't hit its limit again yet.
    expect(checkMemory("b", policy, 100).allowed).toBe(false);
  });

  it("evicts an expired entry on access instead of accumulating its old count", () => {
    const policy: RateLimitPolicy = { limit: 2, windowMs: 1000 };
    checkMemory("k", policy, 0); // count 1
    checkMemory("k", policy, 500); // count 2, at the limit

    const afterExpiry = checkMemory("k", policy, 1000); // window has elapsed
    expect(afterExpiry.allowed).toBe(true);
    expect(afterExpiry.nextState).toEqual({ windowStartMs: 1000, count: 1 });
    expect(_memoryStoreSize()).toBe(1);
  });

  it("sweeps all expired entries once the store exceeds 10k keys", () => {
    const policy: RateLimitPolicy = { limit: 1000, windowMs: 1000 };

    // This entry's window (started at t=0) is long expired by t=5000.
    checkMemory("stale", policy, 0);

    // Push the store past the 10k sweep threshold with fresh (unexpired) keys.
    for (let i = 0; i < 10_000; i++) {
      checkMemory(`fresh-${i}`, policy, 5000);
    }

    // The threshold crossing triggered a sweep that dropped only "stale".
    expect(_memoryStoreSize()).toBe(10_000);
  });
});

describe("rateLimitKey", () => {
  it("prefers userId over any header", () => {
    const req = new Request("http://localhost/api/x", {
      headers: { "x-forwarded-for": "9.9.9.9" },
    });
    expect(rateLimitKey("queue", "user-1", req)).toBe("queue:user:user-1");
  });

  it("uses the first hop of x-forwarded-for when there is no userId", () => {
    const req = new Request("http://localhost/api/x", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(rateLimitKey("queue", null, req)).toBe("queue:ip:1.2.3.4");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const req = new Request("http://localhost/api/x", {
      headers: { "x-real-ip": "8.8.8.8" },
    });
    expect(rateLimitKey("queue", null, req)).toBe("queue:ip:8.8.8.8");
  });

  it('falls back to "anon" when neither header is present', () => {
    const req = new Request("http://localhost/api/x");
    expect(rateLimitKey("queue", null, req)).toBe("queue:ip:anon");
  });
});

describe("enforceRateLimit", () => {
  beforeEach(() => {
    _resetMemoryStore();
  });

  afterEach(() => {
    _resetDbBackend();
    vi.restoreAllMocks();
  });

  it("allows the first hit and returns null", async () => {
    const policy: RateLimitPolicy = { limit: 1, windowMs: 10_000 };
    const req = new Request("http://localhost/api/x");
    const res = await enforceRateLimit(req, "allow-key", { name: "t", policy });
    expect(res).toBeNull();
  });

  it("returns a 429 { error: 'rate_limited' } with a ceil'd Retry-After header", async () => {
    // Drive enforceRateLimit through a stubbed "db" backend so the
    // retryAfterMs value is exact rather than dependent on wall-clock timing.
    registerDbBackend(() => ({
      allowed: false,
      retryAfterMs: 1500,
      remaining: 0,
      nextState: { windowStartMs: 0, count: 2 },
    }));

    const policy: RateLimitPolicy = { limit: 1, windowMs: 10_000 };
    const req = new Request("http://localhost/api/x");
    const res = await enforceRateLimit(req, "blocked-key", {
      name: "t",
      policy,
      backend: "db",
    });

    expect(res).not.toBeNull();
    expect(res?.status).toBe(429);
    expect(res?.headers.get("Retry-After")).toBe("2");
    await expect(res?.json()).resolves.toEqual({ error: "rate_limited" });
  });

  it("actually blocks the (limit + 1)th hit against the default memory backend", async () => {
    const policy: RateLimitPolicy = { limit: 1, windowMs: 10_000 };
    const req = new Request("http://localhost/api/x");
    const first = await enforceRateLimit(req, "memory-key", { name: "t", policy });
    const second = await enforceRateLimit(req, "memory-key", { name: "t", policy });
    expect(first).toBeNull();
    expect(second?.status).toBe(429);
  });

  it('falls back to memory (with a console.warn) when "db" is requested but unregistered', async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const policy: RateLimitPolicy = { limit: 1, windowMs: 10_000 };
    const req = new Request("http://localhost/api/x");

    const first = await enforceRateLimit(req, "fallback-key", {
      name: "t",
      policy,
      backend: "db",
    });
    const second = await enforceRateLimit(req, "fallback-key", {
      name: "t",
      policy,
      backend: "db",
    });

    expect(first).toBeNull();
    expect(second?.status).toBe(429);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("fails open (returns null) and warns when the backend throws", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerDbBackend(() => {
      throw new Error("boom");
    });

    const policy: RateLimitPolicy = { limit: 1, windowMs: 10_000 };
    const req = new Request("http://localhost/api/x");
    const res = await enforceRateLimit(req, "error-key", {
      name: "t",
      policy,
      backend: "db",
    });

    expect(res).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("fails open when a registered async backend rejects", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerDbBackend(async () => {
      throw new Error("async boom");
    });

    const policy: RateLimitPolicy = { limit: 1, windowMs: 10_000 };
    const req = new Request("http://localhost/api/x");
    const res = await enforceRateLimit(req, "async-error-key", {
      name: "t",
      policy,
      backend: "db",
    });

    expect(res).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });
});
