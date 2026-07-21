import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userStatusFixture from "./fixtures/user-status.json";

// The rate limiter lives in module-level state, so every test re-imports the
// module fresh (after vi.resetModules()) to avoid bleed-through between
// cases.
async function importClient() {
  return await import("@/lib/cf/client");
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function htmlResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(`<html><body>error ${status}</body></html>`, {
    status,
    headers: { "content-type": "text/html", ...headers },
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("cfFetch envelope parsing", () => {
  it("resolves with the result on status OK", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(userStatusFixture));
    vi.stubGlobal("fetch", fetchMock);

    const { getUserStatus } = await importClient();
    const submissions = await getUserStatus("tourist");

    expect(submissions).toEqual(userStatusFixture.result);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestedUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(requestedUrl.origin + requestedUrl.pathname).toBe(
      "https://codeforces.com/api/user.status",
    );
    expect(requestedUrl.searchParams.get("handle")).toBe("tourist");
  });

  it("passes optional from/count params through to the query string", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ status: "OK", result: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const { getUserStatus } = await importClient();
    await getUserStatus("tourist", 1, 50);

    const requestedUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(requestedUrl.searchParams.get("from")).toBe("1");
    expect(requestedUrl.searchParams.get("count")).toBe("50");
  });

  it("throws CfApiError with the comment when status is FAILED", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () =>
        jsonResponse({ status: "FAILED", comment: "handles: User not found: nobody" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { getUserInfo, CfApiError } = await importClient();

    await expect(getUserInfo("nobody")).rejects.toBeInstanceOf(CfApiError);
    await expect(getUserInfo("nobody")).rejects.toThrow("User not found");
  });

  it("retries once after a backoff when CF reports its rate limit exceeded", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0); // pin jitter to 0 => backoff is exactly 5000
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ status: "FAILED", comment: "Call limit exceeded" }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: "OK", result: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const { getProblemset } = await importClient();
    const pending = getProblemset();

    // First attempt happens immediately.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Retry is gated behind the 5s backoff, not before.
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await expect(pending).resolves.toEqual([]);
  });

  it("does not retry (and rejects) on a FAILED status unrelated to rate limiting", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ status: "FAILED", comment: "handles: User not found: nobody" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { getUserInfo, CfApiError } = await importClient();
    const pending = getUserInfo("nobody");
    await vi.advanceTimersByTimeAsync(0);

    await expect(pending).rejects.toBeInstanceOf(CfApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("courtesy rate limiting", () => {
  it("spaces successive request starts by at least 2000ms", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ status: "OK", result: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const { getUserStatus } = await importClient();

    const first = getUserStatus("alice");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = getUserStatus("bob");

    // Not yet 2s since the first request started: second must not have
    // started.
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Crossing the 2000ms mark releases the second request.
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await Promise.all([first, second]);
  });

  it("does not delay the very first request", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ status: "OK", result: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const { getUserStatus } = await importClient();
    const pending = getUserStatus("alice");
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await pending;
  });

  it("aborts a queued request without spending a later limiter slot", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ status: "OK", result: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const { getUserStatus } = await importClient();

    const first = getUserStatus("alice");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const controller = new AbortController();
    const queued = getUserStatus("bob", undefined, undefined, { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });

    const third = getUserStatus("carol");
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requestedUrl = new URL(fetchMock.mock.calls[1][0] as string);
    expect(requestedUrl.searchParams.get("handle")).toBe("carol");

    await Promise.all([first, third]);
  });
});

describe("HTTP-level rate limiting and typed errors", () => {
  it("retries a 429 (HTML body) honoring Retry-After and succeeds on attempt 2", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse(429, { "retry-after": "3" }))
      .mockResolvedValueOnce(jsonResponse({ status: "OK", result: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const { getProblemset } = await importClient();
    const pending = getProblemset();

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // delay = max(3000, 5000) + 0 = 5000 (>= the 3000ms Retry-After). Not before.
    await vi.advanceTimersByTimeAsync(2999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2001);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await expect(pending).resolves.toEqual([]);
  });

  it("retries a 503 with an HTML body without a JSON-parse crash", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse(503))
      .mockResolvedValueOnce(jsonResponse({ status: "OK", result: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const { getProblemset } = await importClient();
    const pending = getProblemset();

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await expect(pending).resolves.toEqual([]);
  });

  it("throws a typed CfHttpError on a 404 HTML body and does not retry", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(htmlResponse(404));
    vi.stubGlobal("fetch", fetchMock);

    const { getProblemset, CfHttpError } = await importClient();
    const pending = getProblemset();
    await vi.advanceTimersByTimeAsync(0);

    await expect(pending).rejects.toBeInstanceOf(CfHttpError);
    await expect(pending).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws CfApiError on a non-200 JSON FAILED envelope (as today)", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "FAILED", comment: "handles: User not found" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { getUserInfo, CfApiError } = await importClient();
    const pending = getUserInfo("nobody");
    await vi.advanceTimersByTimeAsync(0);

    await expect(pending).rejects.toBeInstanceOf(CfApiError);
    await expect(pending).rejects.toThrow("User not found");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("exhausts MAX_CF_ATTEMPTS then rethrows CfRateLimitError", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi.fn().mockImplementation(async () => htmlResponse(429));
    vi.stubGlobal("fetch", fetchMock);

    const { getProblemset, CfRateLimitError, MAX_CF_ATTEMPTS } = await importClient();
    expect(MAX_CF_ATTEMPTS).toBe(3);

    const pending = getProblemset();
    const settled = expect(pending).rejects.toBeInstanceOf(CfRateLimitError);

    await vi.advanceTimersByTimeAsync(0); // attempt 1 (call 1)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000); // backoff -> attempt 2 (call 2)
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10000); // backoff -> attempt 3 (call 3), last
    expect(fetchMock).toHaveBeenCalledTimes(MAX_CF_ATTEMPTS);

    await settled;
  });

  it("aborting during the retry backoff rejects and frees the queue", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse(429))
      .mockResolvedValue(jsonResponse({ status: "OK", result: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const { getUserStatus } = await importClient();

    const controller = new AbortController();
    const aborted = getUserStatus("alice", undefined, undefined, { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1); // first attempt done; now in backoff sleep

    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });

    // Queue is not wedged: a subsequent caller still proceeds (after local spacing).
    const next = getUserStatus("bob");
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requestedUrl = new URL(fetchMock.mock.calls[1][0] as string);
    expect(requestedUrl.searchParams.get("handle")).toBe("bob");

    await expect(next).resolves.toEqual([]);
  });
});

describe("computeRetryDelayMs", () => {
  it("bounds exponential backoff with jitter and lets Retry-After dominate", async () => {
    const { computeRetryDelayMs } = await importClient();

    // attempt 0 -> 5000..6000
    expect(computeRetryDelayMs(0, undefined, () => 0)).toBe(5000);
    expect(computeRetryDelayMs(0, undefined, () => 0.5)).toBe(5500);

    // attempt 1 -> 10000..11000
    expect(computeRetryDelayMs(1, undefined, () => 0)).toBe(10000);
    expect(computeRetryDelayMs(1, undefined, () => 0.5)).toBe(10500);

    // exponential term caps at 30000 (5000 * 2**3 = 40000 -> 30000), + jitter
    expect(computeRetryDelayMs(3, undefined, () => 0)).toBe(30000);
    expect(computeRetryDelayMs(10, undefined, () => 0.5)).toBe(30500);

    // Retry-After dominates when larger than the backoff term
    expect(computeRetryDelayMs(0, 50000, () => 0)).toBe(50000);
    // ...but not when smaller
    expect(computeRetryDelayMs(0, 3000, () => 0)).toBe(5000);
  });
});

describe("parseRetryAfterMs", () => {
  it("parses integer seconds, HTTP-dates, and undefined-on-absent", async () => {
    const { parseRetryAfterMs } = await importClient();

    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs("")).toBeUndefined();
    expect(parseRetryAfterMs("not-a-date")).toBeUndefined();
    expect(parseRetryAfterMs("3")).toBe(3000);
    expect(parseRetryAfterMs(" 7 ")).toBe(7000);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    expect(parseRetryAfterMs("Thu, 01 Jan 2026 00:00:10 GMT")).toBe(10000);
    expect(parseRetryAfterMs("Thu, 01 Jan 2026 00:00:00 GMT")).toBe(0);
    expect(parseRetryAfterMs("Wed, 31 Dec 2025 23:59:00 GMT")).toBe(0); // past clamps to 0
  });
});

describe("slot-claimer seam", () => {
  it("calls the installed claimer once per attempt and skips local spacing", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: "FAILED", comment: "Call limit exceeded" }))
      .mockResolvedValueOnce(jsonResponse({ status: "OK", result: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const { getProblemset, setSlotClaimer } = await importClient();
    const claimer = vi.fn().mockResolvedValue(undefined);
    setSlotClaimer(claimer);

    const pending = getProblemset();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(claimer).toHaveBeenCalledTimes(1);
    expect(claimer.mock.calls[0][0]).toHaveProperty("signal");

    await vi.advanceTimersByTimeAsync(5000); // backoff only (no local spacing)
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(claimer).toHaveBeenCalledTimes(2);

    await expect(pending).resolves.toEqual([]);
  });

  it("skips the local 2s spacing between requests while a claimer is installed", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => jsonResponse({ status: "OK", result: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const { getUserStatus, setSlotClaimer } = await importClient();
    setSlotClaimer(async () => undefined);

    const first = getUserStatus("alice");
    const second = getUserStatus("bob");
    // No local spacing: both proceed within the same tick, no 2000ms gap.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await Promise.all([first, second]);
  });

  it("falls back to local spacing when the claimer declines (fallback: true)", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => jsonResponse({ status: "OK", result: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const { getUserStatus, setSlotClaimer } = await importClient();
    const claimer = vi.fn().mockResolvedValue({ fallback: true });
    setSlotClaimer(claimer);

    const first = getUserStatus("alice");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = getUserStatus("bob");
    // Declined claimer => local spacing applies again.
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(claimer).toHaveBeenCalledTimes(2);

    await Promise.all([first, second]);
  });

  it("resetSlotClaimer restores default local spacing", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => jsonResponse({ status: "OK", result: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const { getUserStatus, setSlotClaimer, resetSlotClaimer } = await importClient();
    setSlotClaimer(async () => undefined);
    resetSlotClaimer();

    const first = getUserStatus("alice");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = getUserStatus("bob");
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await Promise.all([first, second]);
  });
});
