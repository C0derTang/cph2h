/**
 * Tests for GET /api/cf/oauth/start (issue #256's rate-limit enforcement;
 * the route itself predates this issue and had no dedicated suite before).
 *
 * `ensureUser`, the OAuth config/URL helpers, and `enforceDbRateLimit` are
 * mocked so the route's own gating order — resolve auth, then rate-limit
 * (keyed by userId when signed in, else null so the route falls back to
 * IP), then the 401 gate, then the redirect — is exercised in isolation,
 * mirroring tests/cf-oauth-callback-route.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  ensureUserMock,
  getOAuthConfigMock,
  getRequestOriginMock,
  buildAuthorizeUrlMock,
  generateStateMock,
  callbackRedirectUriMock,
  enforceDbRateLimitMock,
} = vi.hoisted(() => ({
  ensureUserMock: vi.fn(),
  getOAuthConfigMock: vi.fn(),
  getRequestOriginMock: vi.fn(),
  buildAuthorizeUrlMock: vi.fn(),
  generateStateMock: vi.fn(),
  callbackRedirectUriMock: vi.fn(),
  enforceDbRateLimitMock: vi.fn(),
}));

vi.mock("@/lib/user", () => ({ ensureUser: ensureUserMock }));

vi.mock("@/lib/cf/oauth-server", () => ({
  getOAuthConfig: getOAuthConfigMock,
  getRequestOrigin: getRequestOriginMock,
}));

vi.mock("@/lib/cf/oauth", () => ({
  buildAuthorizeUrl: buildAuthorizeUrlMock,
  callbackRedirectUri: callbackRedirectUriMock,
  generateState: generateStateMock,
  STATE_COOKIE: "cf_oauth_state",
  STATE_COOKIE_MAX_AGE_SEC: 600,
  STATE_COOKIE_PATH: "/api/cf/oauth",
}));

// `src/lib/ratelimit/policies.ts` transitively imports the real `@/lib/db`
// (via `./db.ts`'s registration side effect), which this suite otherwise
// never loads — mocked at the call shape the route uses. Rate-limit
// behavior itself is covered by tests/ratelimit-db.test.ts.
vi.mock("@/lib/ratelimit/policies", () => ({
  enforceDbRateLimit: enforceDbRateLimitMock,
  OAUTH_START_POLICY: { limit: 5, windowMs: 60_000 },
}));

import { GET } from "../src/app/api/cf/oauth/start/route";

const USER = { id: "user-1" };

function makeRequest(): Request {
  return new Request("http://localhost/api/cf/oauth/start");
}

beforeEach(() => {
  ensureUserMock.mockReset().mockResolvedValue(USER);
  getOAuthConfigMock.mockReset().mockReturnValue({
    clientId: "client-id",
    clientSecret: "client-secret",
  });
  getRequestOriginMock.mockReset().mockReturnValue("https://cph2h.example.com");
  buildAuthorizeUrlMock.mockReset().mockReturnValue("https://codeforces.com/oauth/authorize?x=1");
  generateStateMock.mockReset().mockReturnValue("generated-state");
  callbackRedirectUriMock.mockReset().mockReturnValue("https://cph2h.example.com/api/cf/oauth/callback");
  enforceDbRateLimitMock.mockReset().mockResolvedValue(null);
});

describe("GET /api/cf/oauth/start", () => {
  it("redirects to the CF authorize URL when allowed", async () => {
    const res = await GET(makeRequest());

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://codeforces.com/oauth/authorize?x=1");
  });

  it("returns 429 and never builds the authorize URL when the limiter blocks", async () => {
    enforceDbRateLimitMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: { "Retry-After": "5" },
      }),
    );

    const res = await GET(makeRequest());

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("5");
    expect(buildAuthorizeUrlMock).not.toHaveBeenCalled();
  });

  it("is keyed by the authenticated user id", async () => {
    await GET(makeRequest());

    expect(enforceDbRateLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      "oauth_start",
      USER.id,
      expect.anything(),
    );
  });

  it("checks the rate limit (keyed by null, falling back to IP) before the 401 for an unauthenticated caller", async () => {
    ensureUserMock.mockResolvedValue(null);

    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    expect(enforceDbRateLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      "oauth_start",
      null,
      expect.anything(),
    );
    expect(buildAuthorizeUrlMock).not.toHaveBeenCalled();
  });

  it("returns 500 when OAuth is not configured, after the rate-limit check", async () => {
    getOAuthConfigMock.mockReturnValue(null);

    const res = await GET(makeRequest());

    expect(res.status).toBe(500);
    expect(enforceDbRateLimitMock).toHaveBeenCalled();
  });
});
