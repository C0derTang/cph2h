/**
 * Tests for src/app/api/tournament/register/route.ts (issue #209).
 *
 * `requireLinkedUser` and `db` are mocked at the call shapes the route uses
 * (`insert().values().onConflictDoUpdate().returning()`), same pattern as
 * tests/reports-route.test.ts. The real (pure) normalizers from
 * `@/lib/tournament/registration` run unmocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionResult } from "../src/lib/race/session";

const { requireLinkedUserMock, insertValuesMock, onConflictDoUpdateMock, dbState } =
  vi.hoisted(() => {
    const dbState = {
      insertReturning: [] as unknown[],
    };
    return {
      requireLinkedUserMock: vi.fn<() => Promise<SessionResult>>(),
      insertValuesMock: vi.fn(),
      onConflictDoUpdateMock: vi.fn(),
      dbState,
    };
  });

vi.mock("@/lib/race/session", () => ({
  requireLinkedUser: requireLinkedUserMock,
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

beforeEach(() => {
  requireLinkedUserMock.mockReset();
  insertValuesMock.mockClear();
  onConflictDoUpdateMock.mockClear();
  dbState.insertReturning = [];

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

    const res = await POST(makeRequest({ termsAccepted: true }));

    expect(res.status).toBe(401);
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("returns 403 cf_not_linked", async () => {
    requireLinkedUserMock.mockResolvedValue({
      ok: false,
      status: 403,
      error: "cf_not_linked",
    });

    const res = await POST(makeRequest({ termsAccepted: true }));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("cf_not_linked");
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_body for a malformed request", async () => {
    const res = await POST(makeRequest({ termsAccepted: "yes" }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("returns 400 terms_not_accepted when termsAccepted is missing", async () => {
    const res = await POST(makeRequest({}));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("terms_not_accepted");
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("returns 400 terms_not_accepted when termsAccepted is false", async () => {
    const res = await POST(makeRequest({ termsAccepted: false }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("terms_not_accepted");
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_github_url for a bad GitHub URL", async () => {
    const res = await POST(
      makeRequest({ termsAccepted: true, githubUrl: "https://gitlab.com/me" }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_github_url");
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_linkedin_url for a bad LinkedIn URL", async () => {
    const res = await POST(
      makeRequest({
        termsAccepted: true,
        linkedinUrl: "https://linkedin.com.evil.com/in/me",
      }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_linkedin_url");
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("upserts normalized values, treats empty string as null, and sets termsAcceptedAt on insert", async () => {
    const res = await POST(
      makeRequest({
        termsAccepted: true,
        githubUrl: "github.com/torvalds",
        linkedinUrl: "",
      }),
    );

    expect(res.status).toBe(200);
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: USER_ID,
        githubUrl: "https://github.com/torvalds",
        linkedinUrl: null,
        termsAcceptedAt: expect.any(Date),
      }),
    );
  });

  it("upsert set includes updatedAt but not termsAcceptedAt", async () => {
    await POST(
      makeRequest({
        termsAccepted: true,
        githubUrl: "github.com/torvalds",
      }),
    );

    expect(onConflictDoUpdateMock).toHaveBeenCalledTimes(1);
    const config = onConflictDoUpdateMock.mock.calls[0][0];
    expect(config.set).toHaveProperty("updatedAt");
    expect(config.set).not.toHaveProperty("termsAcceptedAt");
    expect(config.set.githubUrl).toBe("https://github.com/torvalds");
  });

  it("returns 200 with the returned row's fields", async () => {
    dbState.insertReturning = [
      {
        userId: USER_ID,
        githubUrl: "https://github.com/torvalds",
        linkedinUrl: null,
        termsAcceptedAt: new Date("2024-01-01T00:00:00Z"),
        createdAt: new Date("2024-01-01T00:00:00Z"),
        updatedAt: new Date("2024-01-02T00:00:00Z"),
      },
    ];

    const res = await POST(
      makeRequest({ termsAccepted: true, githubUrl: "github.com/torvalds" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.githubUrl).toBe("https://github.com/torvalds");
    expect(body.linkedinUrl).toBeNull();
    expect(body.createdAt).toBeTruthy();
    expect(body.updatedAt).toBeTruthy();
  });
});
