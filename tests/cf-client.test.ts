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

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
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
});
