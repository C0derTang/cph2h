/**
 * Tests for src/app/api/cf/link/route.ts
 *
 * Focused on the issue #32 hardening additions:
 *  - per-Clerk-user rate limiting (cooldown + rolling-window attempt cap)
 *  - mapping a `users.cf_handle` unique-constraint violation to a friendly
 *    409 instead of an unhandled 500 (TOCTOU on the pre-check)
 *
 * `@clerk/nextjs/server`, `@/lib/db`, `@/lib/cf/client`, and `@/lib/cf/auth`
 * are mocked at the call shapes the route uses, following the pattern in
 * tests/cf-submit-route.test.ts and tests/run-route.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/lib/db/schema";

const {
  authMock,
  currentUserMock,
  selectMock,
  updateWhereMock,
  insertValuesMock,
  insertOnConflictMock,
  loginToCfMock,
  persistCfSessionMock,
  getCredKeyMock,
  getUserInfoMock,
  getUserStatusMock,
} = vi.hoisted(() => {
  const insertOnConflictMock = vi.fn().mockResolvedValue(undefined);
  const insertValuesMock = vi.fn(() => ({ onConflictDoUpdate: insertOnConflictMock }));
  const updateWhereMock = vi.fn().mockResolvedValue(undefined);
  return {
    authMock: vi.fn(),
    currentUserMock: vi.fn(),
    selectMock: vi.fn(),
    updateWhereMock,
    insertValuesMock,
    insertOnConflictMock,
    loginToCfMock: vi.fn(),
    persistCfSessionMock: vi.fn().mockResolvedValue(undefined),
    getCredKeyMock: vi.fn(() => "0".repeat(64)),
    getUserInfoMock: vi.fn().mockResolvedValue([{ rating: 1500 }]),
    getUserStatusMock: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
  currentUser: currentUserMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: selectMock,
    update: vi.fn(() => ({ set: () => ({ where: updateWhereMock }) })),
    insert: vi.fn(() => ({ values: insertValuesMock })),
  },
}));

vi.mock("@/lib/cf/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/cf/client")>("@/lib/cf/client");
  return { ...actual, getUserInfo: getUserInfoMock, getUserStatus: getUserStatusMock };
});

vi.mock("@/lib/cf/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/cf/auth")>("@/lib/cf/auth");
  return {
    ...actual,
    loginToCf: loginToCfMock,
    persistCfSession: persistCfSessionMock,
    getCredKey: getCredKeyMock,
  };
});

import { POST } from "@/app/api/cf/link/route";
import { CfAuthError } from "@/lib/cf/auth";
import type { CfLinkResponse } from "@/lib/types";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    clerkId: "clerk-1",
    username: "tourist",
    cfHandle: null,
    cfRating: null,
    cfLinkedAt: null,
    elo: 1200,
    racesPlayed: 0,
    cppTemplate: "",
    createdAt: null,
    ...overrides,
  };
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/cf/link", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Queue up successive `db.select()...where()` results in call order. */
function mockSelectSequence(results: unknown[][]) {
  let i = 0;
  selectMock.mockImplementation(() => ({
    from: () => ({
      where: () => Promise.resolve(results[i++] ?? []),
    }),
  }));
}

let clerkCounter = 0;

beforeEach(() => {
  clerkCounter += 1;
  authMock.mockReset();
  currentUserMock.mockReset();
  selectMock.mockReset();
  updateWhereMock.mockReset().mockResolvedValue(undefined);
  insertValuesMock.mockClear();
  insertOnConflictMock.mockReset().mockResolvedValue(undefined);
  loginToCfMock.mockReset();
  persistCfSessionMock.mockReset().mockResolvedValue(undefined);
  getUserInfoMock.mockReset().mockResolvedValue([{ rating: 1500 }]);
  getUserStatusMock.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/cf/link", () => {
  it("links successfully on the happy path", async () => {
    const clerkId = `clerk-happy-${clerkCounter}`;
    authMock.mockResolvedValue({ userId: clerkId, isAuthenticated: true });
    loginToCfMock.mockResolvedValue({
      cookieJar: { JSESSIONID: "sess" },
      csrfToken: "csrf",
      handle: "Tourist",
    });
    mockSelectSequence([[makeUser({ clerkId, id: "user-1" })], []]);

    const res = await POST(makeRequest({ handle: "tourist", password: "hunter2" }));

    expect(res.status).toBe(200);
    const json = (await res.json()) as CfLinkResponse;
    expect(json).toMatchObject({ ok: true, cfHandle: "Tourist", cfRating: 1500 });
    expect(persistCfSessionMock).toHaveBeenCalledWith("user-1", expect.objectContaining({ handle: "Tourist" }));
  });

  it("rejects an immediate repeat attempt via the per-user cooldown", async () => {
    const clerkId = `clerk-cooldown-${clerkCounter}`;
    authMock.mockResolvedValue({ userId: clerkId, isAuthenticated: true });
    loginToCfMock.mockRejectedValue(
      new CfAuthError("invalid_credentials", "Invalid Codeforces handle/email or password."),
    );

    const first = await POST(makeRequest({ handle: "tourist", password: "wrong" }));
    expect(first.status).toBe(401);

    const second = await POST(makeRequest({ handle: "tourist", password: "wrong" }));
    expect(second.status).toBe(429);
    const json = (await second.json()) as CfLinkResponse;
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/too many/i);

    // The cooldown blocks the second call before it ever reaches Codeforces.
    expect(loginToCfMock).toHaveBeenCalledTimes(1);
  });

  it("rejects further attempts once the rolling-window cap is hit", async () => {
    vi.useFakeTimers();
    const clerkId = `clerk-cap-${clerkCounter}`;
    authMock.mockResolvedValue({ userId: clerkId, isAuthenticated: true });
    loginToCfMock.mockRejectedValue(
      new CfAuthError("invalid_credentials", "Invalid Codeforces handle/email or password."),
    );

    // 5 attempts spaced beyond the per-attempt cooldown all reach Codeforces
    // (and are rejected for bad credentials) — each still counts against
    // the rolling-window cap.
    for (let i = 0; i < 5; i++) {
      const res = await POST(makeRequest({ handle: "tourist", password: "wrong" }));
      expect(res.status).toBe(401);
      vi.advanceTimersByTime(6000);
    }

    // The 6th attempt trips the cap before calling loginToCf again.
    const res = await POST(makeRequest({ handle: "tourist", password: "wrong" }));
    expect(res.status).toBe(429);
    const json = (await res.json()) as CfLinkResponse;
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/too many/i);
    expect(loginToCfMock).toHaveBeenCalledTimes(5);
  });

  it("maps a users.cf_handle unique-constraint violation to a friendly 409", async () => {
    const clerkId = `clerk-conflict-${clerkCounter}`;
    authMock.mockResolvedValue({ userId: clerkId, isAuthenticated: true });
    loginToCfMock.mockResolvedValue({
      cookieJar: { JSESSIONID: "sess" },
      csrfToken: "csrf",
      handle: "Tourist",
    });
    // Pre-check (step 4) finds no conflict — another request wins the race
    // and links the handle between the check and this request's update.
    mockSelectSequence([[makeUser({ clerkId, id: "user-1" })], []]);

    const uniqueViolation = Object.assign(
      new Error('duplicate key value violates unique constraint "users_cf_handle_unique"'),
      { code: "23505", constraint: "users_cf_handle_unique" },
    );
    updateWhereMock.mockRejectedValue(uniqueViolation);

    const res = await POST(makeRequest({ handle: "tourist", password: "hunter2" }));

    expect(res.status).toBe(409);
    const json = (await res.json()) as CfLinkResponse;
    expect(json).toMatchObject({ ok: false });
    expect(json.error).toMatch(/already linked/i);
    // The account row's credentials/session are never written once the
    // handle turned out to be taken.
    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(persistCfSessionMock).not.toHaveBeenCalled();
  });

  it("rethrows a non-unique-violation update error instead of masking it as a 409", async () => {
    const clerkId = `clerk-other-error-${clerkCounter}`;
    authMock.mockResolvedValue({ userId: clerkId, isAuthenticated: true });
    loginToCfMock.mockResolvedValue({
      cookieJar: { JSESSIONID: "sess" },
      csrfToken: "csrf",
      handle: "Tourist",
    });
    mockSelectSequence([[makeUser({ clerkId, id: "user-1" })], []]);
    updateWhereMock.mockRejectedValue(new Error("connection reset"));

    await expect(POST(makeRequest({ handle: "tourist", password: "hunter2" }))).rejects.toThrow(
      "connection reset",
    );
  });

  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValue({ userId: null, isAuthenticated: false });

    const res = await POST(makeRequest({ handle: "tourist", password: "hunter2" }));

    expect(res.status).toBe(401);
    expect(loginToCfMock).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid body without spending a rate-limit attempt", async () => {
    const clerkId = `clerk-badbody-${clerkCounter}`;
    authMock.mockResolvedValue({ userId: clerkId, isAuthenticated: true });

    const res = await POST(makeRequest({ handle: "", password: "" }));

    expect(res.status).toBe(400);
    expect(loginToCfMock).not.toHaveBeenCalled();

    // A bad body doesn't burn the rate-limit budget: a valid follow-up
    // attempt from the same user still goes through.
    loginToCfMock.mockRejectedValue(
      new CfAuthError("invalid_credentials", "Invalid Codeforces handle/email or password."),
    );
    const res2 = await POST(makeRequest({ handle: "tourist", password: "wrong" }));
    expect(res2.status).toBe(401);
  });
});
