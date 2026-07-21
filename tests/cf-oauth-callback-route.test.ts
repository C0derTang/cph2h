/**
 * Route-level tests for GET /api/cf/oauth/callback.
 *
 * The real handler runs with mocked auth/DB/CF/env, but a REAL `jose`-signed
 * id_token so the load-bearing HS256-signature invariant is actually
 * exercised: a token signed with the client secret links the handle; a token
 * signed with any other key is rejected and never links. Also covers the CSRF
 * `state` check, handle-uniqueness, and missing env config.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import { CF_ISSUER } from "@/lib/cf/oauth";

const CLIENT_ID = "cph2h-client";
const CLIENT_SECRET = "super-secret-value";
const ORIGIN = "https://cph2h.example.com";
const STATE = "state-token-abc";
const USER = { id: "user-1" };

const {
  ensureUserMock,
  selectMock,
  updateSetMock,
  updateWhereMock,
  getUserInfoMock,
  importSolveHistoryMock,
  getOAuthConfigMock,
  getCheaterSetMock,
  enforceDbRateLimitMock,
} = vi.hoisted(() => ({
  ensureUserMock: vi.fn(),
  selectMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  getUserInfoMock: vi.fn(),
  importSolveHistoryMock: vi.fn(),
  getOAuthConfigMock: vi.fn(),
  getCheaterSetMock: vi.fn(),
  enforceDbRateLimitMock: vi.fn(),
}));

// `src/lib/ratelimit/policies.ts` transitively imports the real `@/lib/db`
// (via `./db.ts`'s registration side effect); mocked here at the call shape
// the route uses so this suite's own `@/lib/db` mock stays the source of
// truth. Rate-limit behavior itself is covered by tests/ratelimit-db.test.ts.
vi.mock("@/lib/ratelimit/policies", () => ({
  enforceDbRateLimit: enforceDbRateLimitMock,
  OAUTH_CALLBACK_POLICY: { limit: 3, windowMs: 60_000 },
}));

vi.mock("@/lib/user", () => ({ ensureUser: ensureUserMock }));

vi.mock("@/lib/db", () => ({
  db: {
    select: selectMock,
    update: () => ({ set: updateSetMock }),
  },
}));

vi.mock("@/lib/cf/client", () => {
  class CfApiError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "CfApiError";
    }
  }
  return { CfApiError, getUserInfo: getUserInfoMock };
});

vi.mock("@/lib/cf/history", () => ({ importSolveHistory: importSolveHistoryMock }));

vi.mock("@/lib/cf/oauth-server", () => ({
  getOAuthConfig: getOAuthConfigMock,
  getRequestOrigin: () => ORIGIN,
}));

vi.mock("@/lib/cf/cheaters", () => ({
  getCheaterSet: getCheaterSetMock,
  isKnownCheater: (handle: string, set: Set<string>) => set.has(handle.toLowerCase()),
}));

import { GET } from "../src/app/api/cf/oauth/callback/route";

function mockConflictRows(rows: unknown[]) {
  selectMock.mockImplementation(() => ({
    from: () => ({ where: () => Promise.resolve(rows) }),
  }));
}

async function signIdToken(
  secret: string,
  overrides: { handle?: string; rating?: number; aud?: string; iss?: string } = {},
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({
    handle: overrides.handle ?? "tourist",
    ...(overrides.rating !== undefined ? { rating: overrides.rating } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(overrides.iss ?? CF_ISSUER)
    .setAudience(overrides.aud ?? CLIENT_ID)
    .setExpirationTime("1h")
    .sign(key);
}

function makeRequest(opts: { state?: string | null; code?: string | null; error?: string } = {}): NextRequest {
  const url = new URL(`${ORIGIN}/api/cf/oauth/callback`);
  if (opts.code !== null) url.searchParams.set("code", opts.code ?? "auth-code");
  if (opts.state !== null) url.searchParams.set("state", opts.state ?? STATE);
  if (opts.error) url.searchParams.set("error", opts.error);
  const headers = new Headers();
  headers.set("cookie", `cf_oauth_state=${STATE}`);
  return new NextRequest(url, { headers });
}

/** Set fetch to return a token endpoint response carrying `idToken`. */
function stubTokenFetch(idToken: string | null, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      json: async () => (idToken === null ? {} : { id_token: idToken }),
    }),
  );
}

function locationOf(response: Response): URL {
  return new URL(response.headers.get("location") ?? "");
}

beforeEach(() => {
  ensureUserMock.mockReset().mockResolvedValue(USER);
  selectMock.mockReset();
  mockConflictRows([]);
  updateSetMock.mockReset().mockReturnValue({ where: updateWhereMock });
  updateWhereMock.mockReset().mockResolvedValue(undefined);
  getUserInfoMock.mockReset().mockResolvedValue([{ handle: "tourist", rating: 1500 }]);
  importSolveHistoryMock.mockReset().mockResolvedValue(undefined);
  getOAuthConfigMock
    .mockReset()
    .mockReturnValue({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
  getCheaterSetMock.mockReset().mockResolvedValue(new Set());
  enforceDbRateLimitMock.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/cf/oauth/callback", () => {
  it("links the handle on a valid, correctly-signed id_token", async () => {
    stubTokenFetch(await signIdToken(CLIENT_SECRET, { rating: 3800 }));

    const response = await GET(makeRequest());

    expect(response.status).toBe(307);
    const loc = locationOf(response);
    expect(loc.pathname).toBe("/settings/cf");
    expect(loc.searchParams.get("linked")).toBe("1");
    expect(loc.searchParams.get("error")).toBeNull();

    expect(updateSetMock).toHaveBeenCalledTimes(1);
    const setArg = updateSetMock.mock.calls[0][0] as Record<string, unknown>;
    expect(setArg.cfHandle).toBe("tourist");
    expect(setArg.cfRating).toBe(3800);
    expect(setArg.username).toBe("tourist");
    expect(setArg.cfLinkedAt).toBeInstanceOf(Date);
    expect(importSolveHistoryMock).toHaveBeenCalledWith(
      USER.id,
      "tourist",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    // Single-use state cookie is cleared.
    expect(response.headers.get("set-cookie")).toContain("cf_oauth_state=");
  });

  it("rejects a forged id_token signed with the wrong secret — never links", async () => {
    stubTokenFetch(await signIdToken("attacker-secret", { rating: 3800 }));

    const response = await GET(makeRequest());

    expect(locationOf(response).searchParams.get("error")).toBe("oauth_invalid_token");
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("rejects a token with the wrong audience", async () => {
    stubTokenFetch(await signIdToken(CLIENT_SECRET, { aud: "someone-else" }));

    const response = await GET(makeRequest());

    expect(locationOf(response).searchParams.get("error")).toBe("oauth_invalid_token");
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("rejects a mismatched CSRF state without exchanging the code", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(makeRequest({ state: "not-the-cookie-state" }));

    expect(locationOf(response).searchParams.get("error")).toBe("oauth_state");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("rejects when the CF authorize hop returned an error (user denied)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(makeRequest({ error: "access_denied" }));

    expect(locationOf(response).searchParams.get("error")).toBe("oauth_denied");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a handle on the cheater blocklist and never links (issue #184)", async () => {
    getCheaterSetMock.mockResolvedValue(new Set(["tourist"]));
    stubTokenFetch(await signIdToken(CLIENT_SECRET, { rating: 3800 }));

    const response = await GET(makeRequest());

    expect(locationOf(response).searchParams.get("error")).toBe("cheater_blocked");
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("cheater check is case-insensitive", async () => {
    getCheaterSetMock.mockResolvedValue(new Set(["tourist"]));
    stubTokenFetch(await signIdToken(CLIENT_SECRET, { handle: "TOURIST", rating: 3800 }));

    const response = await GET(makeRequest());

    expect(locationOf(response).searchParams.get("error")).toBe("cheater_blocked");
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("fails open and links when the cheater list is unavailable", async () => {
    getCheaterSetMock.mockResolvedValue(null);
    stubTokenFetch(await signIdToken(CLIENT_SECRET, { rating: 3800 }));

    const response = await GET(makeRequest());

    expect(locationOf(response).searchParams.get("linked")).toBe("1");
    expect(updateSetMock).toHaveBeenCalledTimes(1);
  });

  it("enforces the cheater check before the handle-conflict check", async () => {
    getCheaterSetMock.mockResolvedValue(new Set(["tourist"]));
    mockConflictRows([{ id: "user-2" }]);
    stubTokenFetch(await signIdToken(CLIENT_SECRET, { rating: 3800 }));

    const response = await GET(makeRequest());

    // A handle that is both a known cheater AND owned by another user
    // reports cheater_blocked, not handle_taken — cheater check runs first.
    expect(locationOf(response).searchParams.get("error")).toBe("cheater_blocked");
  });

  it("does not check the cheater list before the state/token checks pass", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await GET(makeRequest({ state: "not-the-cookie-state" }));

    expect(getCheaterSetMock).not.toHaveBeenCalled();
  });

  it("rejects a handle already linked to another user", async () => {
    mockConflictRows([{ id: "user-2" }]);
    stubTokenFetch(await signIdToken(CLIENT_SECRET, { rating: 3800 }));

    const response = await GET(makeRequest());

    expect(locationOf(response).searchParams.get("error")).toBe("handle_taken");
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("falls back to user.info rating when the claim omits it", async () => {
    stubTokenFetch(await signIdToken(CLIENT_SECRET));

    const response = await GET(makeRequest());

    expect(locationOf(response).searchParams.get("linked")).toBe("1");
    const setArg = updateSetMock.mock.calls[0][0] as Record<string, unknown>;
    expect(setArg.cfRating).toBe(1500);
    expect(getUserInfoMock).toHaveBeenCalledWith("tourist");
  });

  it("returns oauth_misconfigured when env is unset", async () => {
    getOAuthConfigMock.mockReturnValue(null);

    const response = await GET(makeRequest());

    expect(locationOf(response).searchParams.get("error")).toBe("oauth_misconfigured");
  });
});

describe("GET /api/cf/oauth/callback — rate limiting (issue #256)", () => {
  it("returns a 429 response verbatim and never exchanges the code when the limiter blocks", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    enforceDbRateLimitMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: { "Retry-After": "12" },
      }),
    );

    const response = await GET(makeRequest());

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("is keyed by the authenticated user id", async () => {
    stubTokenFetch(await signIdToken(CLIENT_SECRET, { rating: 3800 }));

    await GET(makeRequest());

    expect(enforceDbRateLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      "oauth_callback",
      USER.id,
      expect.anything(),
    );
  });

  it("checks the rate limit (keyed by null, falling back to IP) before the 401 for an unauthenticated caller", async () => {
    ensureUserMock.mockResolvedValue(null);

    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(enforceDbRateLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      "oauth_callback",
      null,
      expect.anything(),
    );
  });
});
