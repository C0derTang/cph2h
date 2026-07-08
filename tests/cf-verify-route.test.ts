/**
 * Route-level tests for the Codeforces compile-error verification flow.
 *
 * Both routes use the real handlers with mocked auth/user resolution, DB
 * chains, and Codeforces calls. The assertions pin the public route behavior
 * and the persistence side effects that make the start/check handshake work.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  ensureUserMock,
  selectMock,
  insertValuesMock,
  insertOnConflictDoUpdateMock,
  updateSetMock,
  updateWhereMock,
  deleteWhereMock,
  getUserInfoMock,
  getUserStatusMock,
  hasCompileErrorSinceMock,
  importSolveHistoryMock,
} = vi.hoisted(() => ({
  ensureUserMock: vi.fn(),
  selectMock: vi.fn(),
  insertValuesMock: vi.fn(),
  insertOnConflictDoUpdateMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  deleteWhereMock: vi.fn(),
  getUserInfoMock: vi.fn(),
  getUserStatusMock: vi.fn(),
  hasCompileErrorSinceMock: vi.fn(),
  importSolveHistoryMock: vi.fn(),
}));

vi.mock("@/lib/user", () => ({
  ensureUser: ensureUserMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: selectMock,
    insert: () => ({ values: insertValuesMock }),
    update: () => ({ set: updateSetMock }),
    delete: () => ({ where: deleteWhereMock }),
  },
}));

vi.mock("@/lib/cf/client", async () => {
  class CfApiError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "CfApiError";
    }
  }

  return {
    CfApiError,
    getUserInfo: getUserInfoMock,
    getUserStatus: getUserStatusMock,
  };
});

vi.mock("@/lib/cf/verdicts", () => ({
  hasCompileErrorSince: hasCompileErrorSinceMock,
}));

vi.mock("@/lib/cf/history", () => ({
  importSolveHistory: importSolveHistoryMock,
}));

import { POST as startPOST } from "../src/app/api/cf/verify/start/route";
import { POST as checkPOST } from "../src/app/api/cf/verify/check/route";

const USER = { id: "user-1" };
const NOW = new Date("2026-07-08T15:00:00Z");

function mockSelectResult(rows: unknown[]) {
  selectMock.mockImplementation(() => ({
    from: () => ({
      where: () => Promise.resolve(rows),
    }),
  }));
}

function makeStartRequest(body: unknown): Request {
  return new Request("http://localhost/api/cf/verify/start", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function mockVerificationRow(overrides: Record<string, unknown> = {}) {
  const row = {
    userId: USER.id,
    handle: "tourist",
    problemId: "4A",
    createdAt: new Date(NOW.getTime() - 30_000),
    expiresAt: new Date(NOW.getTime() + 30_000),
    ...overrides,
  };
  mockSelectResult([row]);
  return row;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);

  ensureUserMock.mockReset().mockResolvedValue(USER);
  selectMock.mockReset();

  insertValuesMock.mockReset().mockReturnValue({
    onConflictDoUpdate: insertOnConflictDoUpdateMock,
  });
  insertOnConflictDoUpdateMock.mockReset().mockResolvedValue(undefined);

  updateSetMock.mockReset().mockReturnValue({ where: updateWhereMock });
  updateWhereMock.mockReset().mockResolvedValue(undefined);
  deleteWhereMock.mockReset().mockResolvedValue(undefined);

  getUserInfoMock.mockReset().mockResolvedValue([{ handle: "tourist", rating: 3500 }]);
  getUserStatusMock.mockReset().mockResolvedValue([]);
  hasCompileErrorSinceMock.mockReset().mockReturnValue(true);
  importSolveHistoryMock.mockReset().mockResolvedValue(undefined);

  vi.spyOn(Math, "random").mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("POST /api/cf/verify/start", () => {
  it("rejects an empty handle before calling Codeforces or the database", async () => {
    const res = await startPOST(makeStartRequest({ handle: "   " }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({ ok: false, error: "Handle is required." });
    expect(getUserInfoMock).not.toHaveBeenCalled();
    expect(selectMock).not.toHaveBeenCalled();
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the canonical handle is already linked to another account", async () => {
    mockSelectResult([{ id: "other-user" }]);

    const res = await startPOST(makeStartRequest({ handle: "Tourist" }));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json).toEqual({
      ok: false,
      error: "That Codeforces handle is already linked to another account.",
    });
    expect(getUserInfoMock).toHaveBeenCalledWith("Tourist");
    expect(insertValuesMock).not.toHaveBeenCalled();
  });

  it("upserts a new verification challenge with canonical handle casing", async () => {
    mockSelectResult([]);
    getUserInfoMock.mockResolvedValue([{ handle: "Tourist", rating: 3800 }]);

    const res = await startPOST(makeStartRequest({ handle: " tourist " }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      handle: "Tourist",
      problemId: "4A",
      problemName: "Watermelon",
      problemUrl: "https://codeforces.com/problemset/problem/4/A",
      expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
    });
    expect(insertValuesMock).toHaveBeenCalledWith({
      userId: USER.id,
      handle: "Tourist",
      problemId: "4A",
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    expect(insertOnConflictDoUpdateMock).toHaveBeenCalledWith({
      target: expect.anything(),
      set: {
        handle: "Tourist",
        problemId: "4A",
        createdAt: NOW,
        expiresAt: new Date(NOW.getTime() + 60_000),
      },
    });
  });
});

describe("POST /api/cf/verify/check", () => {
  it("returns 410 and deletes an expired verification row", async () => {
    mockVerificationRow({ expiresAt: new Date(NOW.getTime() - 1) });

    const res = await checkPOST();
    const json = await res.json();

    expect(res.status).toBe(410);
    expect(json).toEqual({ ok: false, error: "Verification expired. Start again." });
    expect(deleteWhereMock).toHaveBeenCalledTimes(1);
    expect(getUserStatusMock).not.toHaveBeenCalled();
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("returns 200 not_found_yet when the compile error has not appeared", async () => {
    const verification = mockVerificationRow();
    hasCompileErrorSinceMock.mockReturnValue(false);

    const res = await checkPOST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: false, error: "not_found_yet" });
    expect(getUserStatusMock).toHaveBeenCalledWith("tourist", 1, 30);
    expect(hasCompileErrorSinceMock).toHaveBeenCalledWith(
      [],
      verification.problemId,
      Math.floor(verification.createdAt.getTime() / 1000) - 60,
    );
    expect(updateSetMock).not.toHaveBeenCalled();
    expect(deleteWhereMock).not.toHaveBeenCalled();
  });

  it("links the handle, rating, and timestamp, then deletes the verification row", async () => {
    mockVerificationRow({ handle: "Tourist", problemId: "4A" });
    getUserInfoMock.mockResolvedValue([{ handle: "Tourist", rating: 3800 }]);

    const res = await checkPOST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, cfHandle: "Tourist", cfRating: 3800 });
    expect(updateSetMock).toHaveBeenCalledWith({
      cfHandle: "Tourist",
      cfRating: 3800,
      cfLinkedAt: NOW,
      username: "Tourist",
    });
    expect(importSolveHistoryMock).toHaveBeenCalledWith(USER.id, "Tourist");
    expect(deleteWhereMock).toHaveBeenCalledTimes(1);
  });
});
