/**
 * Tests for src/app/api/tournament/register/route.ts (issues #209, #239).
 *
 * `requireLinkedUser` and `db` are mocked at the call shapes the route uses
 * (`insert().values().onConflictDoUpdate().returning()`), same pattern as
 * tests/reports-route.test.ts. The real (pure) normalizers from
 * `@/lib/tournament/registration` run unmocked.
 *
 * `firstName`/`lastName`/`email` are required by the zod body schema (issue
 * #239) — a body missing any of them fails schema validation and returns
 * `invalid_body`, distinct from a present-but-invalid value (e.g. an
 * all-whitespace name), which reaches the normalizer and returns the
 * field-specific `invalid_*` code. `baseBody` supplies valid defaults for
 * tests that aren't exercising identity-field validation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import type { SessionResult } from "../src/lib/race/session";

const {
  requireLinkedUserMock,
  getUserInfoMock,
  insertValuesMock,
  onConflictDoUpdateMock,
  enforceDbRateLimitMock,
  dbState,
} = vi.hoisted(() => {
  const dbState = {
    insertReturning: [] as unknown[],
  };
  return {
    requireLinkedUserMock: vi.fn<() => Promise<SessionResult>>(),
    getUserInfoMock: vi.fn(),
    insertValuesMock: vi.fn(),
    onConflictDoUpdateMock: vi.fn(),
    enforceDbRateLimitMock: vi.fn(),
    dbState,
  };
});

vi.mock("@/lib/race/session", () => ({
  requireLinkedUser: requireLinkedUserMock,
}));

vi.mock("@/lib/cf/client", () => ({
  getUserInfo: getUserInfoMock,
}));

// `src/lib/ratelimit/policies.ts` transitively imports the real `@/lib/db`
// (via `./db.ts`'s registration side effect); mocked here at the call shape
// the route uses so this suite's own `@/lib/db` mock stays the source of
// truth. Rate-limit behavior itself is covered by tests/ratelimit-db.test.ts.
vi.mock("@/lib/ratelimit/policies", () => ({
  enforceDbRateLimit: enforceDbRateLimitMock,
  TOURNAMENT_REGISTER_POLICY: { limit: 3, windowMs: 60_000 },
}));

vi.mock("@/lib/db", () => ({
  db: {
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        insertValuesMock(table, values);
        return {
          onConflictDoUpdate: (config: {
            target: unknown;
            set: Record<string, unknown>;
          }) => {
            onConflictDoUpdateMock(config);
            return {
              returning: () => Promise.resolve(dbState.insertReturning),
            };
          },
        };
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  tournamentRegistrations: { userId: "user_id" },
}));

import { POST } from "../src/app/api/tournament/register/route";

const USER_ID = "user-1";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/tournament/register", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Valid defaults for the required identity fields + termsAccepted, so
 *  tests unrelated to identity-field validation don't have to repeat them. */
function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    firstName: "Grace",
    lastName: "Hopper",
    email: "grace@example.com",
    termsAccepted: true,
    ...overrides,
  };
}

/** Fake CF `user.info` response — one entry for the handle, `maxRating`
 *  omitted (undefined) for an unrated handle. */
function userInfo(maxRating?: number) {
  return [{ handle: "cfhandle", maxRating }];
}

beforeEach(() => {
  requireLinkedUserMock.mockReset();
  getUserInfoMock.mockReset();
  insertValuesMock.mockClear();
  onConflictDoUpdateMock.mockClear();
  enforceDbRateLimitMock.mockReset().mockResolvedValue(null);
  dbState.insertReturning = [];

  // Eligible by default so tests that don't care about eligibility pass.
  getUserInfoMock.mockResolvedValue(userInfo(1920));

  requireLinkedUserMock.mockResolvedValue({
    ok: true,
    user: {
      id: USER_ID,
      clerkId: "clerk-1",
      username: "u1",
      cfHandle: "cfhandle",
      cfRating: 1400,
      cfLinkedAt: new Date(),
      elo: 1200,
      racesPlayed: 3,
      cppTemplate: "",
      solveHistorySyncedAt: null,
      solveHistoryImportCursor: null,
      createdAt: null,
      isAdmin: false,
    },
  });

  dbState.insertReturning = [
    {
      userId: USER_ID,
      firstName: "Grace",
      lastName: "Hopper",
      email: "grace@example.com",
      location: null,
      githubUrl: null,
      linkedinUrl: null,
      termsAcceptedAt: new Date("2024-01-01T00:00:00Z"),
      createdAt: new Date("2024-01-01T00:00:00Z"),
      updatedAt: new Date("2024-01-01T00:00:00Z"),
    },
  ];
});

describe("POST /api/tournament/register", () => {
  it("returns 401 when unauthenticated", async () => {
    requireLinkedUserMock.mockResolvedValue({
      ok: false,
      status: 401,
      error: "unauthorized",
    });

    const res = await POST(makeRequest(baseBody()));

    expect(res.status).toBe(401);
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("returns 403 cf_not_linked", async () => {
    requireLinkedUserMock.mockResolvedValue({
      ok: false,
      status: 403,
      error: "cf_not_linked",
    });

    const res = await POST(makeRequest(baseBody()));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("cf_not_linked");
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_body for a malformed request", async () => {
    const res = await POST(makeRequest(baseBody({ termsAccepted: "yes" })));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_body when a required identity field is missing", async () => {
    const res = await POST(makeRequest({ termsAccepted: true }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("returns 400 terms_not_accepted when termsAccepted is missing", async () => {
    const res = await POST(
      makeRequest({ firstName: "Grace", lastName: "Hopper", email: "grace@example.com" }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("terms_not_accepted");
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("returns 400 terms_not_accepted when termsAccepted is false", async () => {
    const res = await POST(makeRequest(baseBody({ termsAccepted: false })));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("terms_not_accepted");
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_first_name for a whitespace-only first name", async () => {
    const res = await POST(makeRequest(baseBody({ firstName: "   " })));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_first_name");
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_first_name for an over-length first name", async () => {
    const res = await POST(makeRequest(baseBody({ firstName: "a".repeat(101) })));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_first_name");
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_last_name for a control character", async () => {
    const res = await POST(makeRequest(baseBody({ lastName: "Hop\nper" })));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_last_name");
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_email for a malformed email", async () => {
    const res = await POST(makeRequest(baseBody({ email: "not-an-email" })));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_email");
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_location for an invalid (non-empty, control-char) location", async () => {
    const res = await POST(makeRequest(baseBody({ location: "SF\nCA" })));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_location");
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_github_url for a bad GitHub URL", async () => {
    const res = await POST(
      makeRequest(baseBody({ githubUrl: "https://gitlab.com/me" })),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_github_url");
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_linkedin_url for a bad LinkedIn URL", async () => {
    const res = await POST(
      makeRequest(
        baseBody({ linkedinUrl: "https://linkedin.com.evil.com/in/me" }),
      ),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_linkedin_url");
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("upserts normalized values, treats empty string as null, and sets termsAcceptedAt on insert", async () => {
    const res = await POST(
      makeRequest(
        baseBody({
          location: "  San Francisco  ",
          githubUrl: "github.com/torvalds",
          linkedinUrl: "",
        }),
      ),
    );

    expect(res.status).toBe(200);
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: USER_ID,
        firstName: "Grace",
        lastName: "Hopper",
        email: "grace@example.com",
        location: "San Francisco",
        githubUrl: "https://github.com/torvalds",
        linkedinUrl: null,
        termsAcceptedAt: expect.any(Date),
      }),
    );
  });

  it("treats an empty-string location as null", async () => {
    await POST(makeRequest(baseBody({ location: "" })));

    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ location: null }),
    );
  });

  it("lowercases only the domain part of the email on upsert", async () => {
    await POST(makeRequest(baseBody({ email: "Grace.Hopper@EXAMPLE.COM" })));

    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ email: "Grace.Hopper@example.com" }),
    );
  });

  it("upsert set includes updatedAt and the four identity/location columns but not termsAcceptedAt", async () => {
    await POST(
      makeRequest(baseBody({ location: "Remote", githubUrl: "github.com/torvalds" })),
    );

    expect(onConflictDoUpdateMock).toHaveBeenCalledTimes(1);
    const config = onConflictDoUpdateMock.mock.calls[0][0];
    expect(config.set).toHaveProperty("updatedAt");
    expect(config.set).not.toHaveProperty("termsAcceptedAt");
    expect(config.set.firstName).toBe("Grace");
    expect(config.set.lastName).toBe("Hopper");
    expect(config.set.email).toBe("grace@example.com");
    expect(config.set.location).toBe("Remote");
    expect(config.set.githubUrl).toBe("https://github.com/torvalds");
  });

  it("returns 403 rating_too_low with the peak rating when peak is 1899", async () => {
    getUserInfoMock.mockResolvedValue(userInfo(1899));

    const res = await POST(makeRequest(baseBody()));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("rating_too_low");
    expect(body.peakRating).toBe(1899);
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("proceeds with the upsert at exactly peak rating 1900", async () => {
    getUserInfoMock.mockResolvedValue(userInfo(1900));

    const res = await POST(makeRequest(baseBody()));

    expect(res.status).toBe(200);
    expect(getUserInfoMock).toHaveBeenCalledWith("cfhandle");
    expect(insertValuesMock).toHaveBeenCalledTimes(1);
  });

  it("returns 403 rating_too_low for an unrated handle (maxRating absent)", async () => {
    getUserInfoMock.mockResolvedValue(userInfo(undefined));

    const res = await POST(makeRequest(baseBody()));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("rating_too_low");
    expect(body.peakRating).toBeNull();
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("returns 502 cf_unavailable when the CF API call fails", async () => {
    getUserInfoMock.mockRejectedValue(new Error("CF down"));

    const res = await POST(makeRequest(baseBody()));

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("cf_unavailable");
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("does not call CF before body/terms/identity/URL validation", async () => {
    const invalidBody = await POST(makeRequest(baseBody({ termsAccepted: "yes" })));
    expect(invalidBody.status).toBe(400);

    const termsMissing = await POST(
      makeRequest({ firstName: "Grace", lastName: "Hopper", email: "grace@example.com" }),
    );
    expect(termsMissing.status).toBe(400);

    const invalidName = await POST(makeRequest(baseBody({ firstName: "   " })));
    expect(invalidName.status).toBe(400);

    const badUrl = await POST(
      makeRequest(baseBody({ githubUrl: "https://gitlab.com/me" })),
    );
    expect(badUrl.status).toBe(400);

    expect(getUserInfoMock).not.toHaveBeenCalled();
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("returns 200 with the returned row's fields", async () => {
    dbState.insertReturning = [
      {
        userId: USER_ID,
        firstName: "Grace",
        lastName: "Hopper",
        email: "grace@example.com",
        location: "Remote",
        githubUrl: "https://github.com/torvalds",
        linkedinUrl: null,
        termsAcceptedAt: new Date("2024-01-01T00:00:00Z"),
        createdAt: new Date("2024-01-01T00:00:00Z"),
        updatedAt: new Date("2024-01-02T00:00:00Z"),
      },
    ];

    const res = await POST(
      makeRequest(baseBody({ location: "Remote", githubUrl: "github.com/torvalds" })),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.firstName).toBe("Grace");
    expect(body.lastName).toBe("Hopper");
    expect(body.email).toBe("grace@example.com");
    expect(body.location).toBe("Remote");
    expect(body.githubUrl).toBe("https://github.com/torvalds");
    expect(body.linkedinUrl).toBeNull();
    expect(body.createdAt).toBeTruthy();
    expect(body.updatedAt).toBeTruthy();
  });
});

describe("POST /api/tournament/register — rate limiting (issue #256)", () => {
  it("returns 429 and does not insert when the limiter blocks", async () => {
    enforceDbRateLimitMock.mockResolvedValue(
      NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": "20" } }),
    );

    const res = await POST(makeRequest(baseBody()));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("20");
    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(getUserInfoMock).not.toHaveBeenCalled();
  });

  it("is keyed by the authenticated user id", async () => {
    await POST(makeRequest(baseBody()));

    expect(enforceDbRateLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      "tournament_register",
      USER_ID,
      expect.anything(),
    );
  });

  it("does not enforce the rate limit when unauthenticated", async () => {
    requireLinkedUserMock.mockResolvedValue({ ok: false, status: 401, error: "unauthorized" });

    const res = await POST(makeRequest(baseBody()));

    expect(res.status).toBe(401);
    expect(enforceDbRateLimitMock).not.toHaveBeenCalled();
  });
});
