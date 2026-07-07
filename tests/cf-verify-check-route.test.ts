/**
 * Tests for src/app/api/cf/verify/check/route.ts.
 *
 * Focus: issue #120 — on a successful compile-error verification the route
 * must sync `users.username` to the verified handle alongside `cfHandle`
 * (display name follows the linked CF handle; no more editable username).
 * Also covers the surrounding control flow (no pending verification,
 * expired verification, not-yet-observed compile error, and the
 * cf_handle-unique-violation 409) since there was no prior test file for
 * this route.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  ensureUserMock,
  selectMock,
  updateSetMock,
  updateWhereMock,
  deleteWhereMock,
  getUserStatusMock,
  getUserInfoMock,
  hasCompileErrorSinceMock,
  importSolveHistoryMock,
} = vi.hoisted(() => ({
  ensureUserMock: vi.fn(),
  selectMock: vi.fn(),
  updateSetMock: vi.fn(),
  updateWhereMock: vi.fn(),
  deleteWhereMock: vi.fn(),
  getUserStatusMock: vi.fn(),
  getUserInfoMock: vi.fn(),
  hasCompileErrorSinceMock: vi.fn(),
  importSolveHistoryMock: vi.fn(),
}));

vi.mock("@/lib/user", () => ({
  ensureUser: ensureUserMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: selectMock,
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
    getUserStatus: getUserStatusMock,
    getUserInfo: getUserInfoMock,
  };
});

vi.mock("@/lib/cf/verdicts", () => ({
  hasCompileErrorSince: hasCompileErrorSinceMock,
}));

vi.mock("@/lib/cf/history", () => ({
  importSolveHistory: importSolveHistoryMock,
}));

import { POST } from "../src/app/api/cf/verify/check/route";

const USER = { id: "user-1" };
const NOW = new Date("2026-07-07T12:00:00Z");

function mockVerificationRow(overrides: Record<string, unknown> = {}) {
  const row = {
    userId: USER.id,
    handle: "tourist",
    problemId: "1000A",
    createdAt: new Date(NOW.getTime() - 30_000),
    expiresAt: new Date(NOW.getTime() + 60_000),
    ...overrides,
  };
  selectMock.mockImplementation(() => ({
    from: () => ({
      where: () => Promise.resolve([row]),
    }),
  }));
  return row;
}

function mockNoVerification() {
  selectMock.mockImplementation(() => ({
    from: () => ({
      where: () => Promise.resolve([]),
    }),
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);

  ensureUserMock.mockReset().mockResolvedValue(USER);
  selectMock.mockReset();
  updateSetMock.mockReset().mockReturnValue({ where: updateWhereMock });
  updateWhereMock.mockReset().mockResolvedValue(undefined);
  deleteWhereMock.mockReset().mockResolvedValue(undefined);
  getUserStatusMock.mockReset().mockResolvedValue([]);
  getUserInfoMock.mockReset().mockResolvedValue([{ rating: 3500 }]);
  hasCompileErrorSinceMock.mockReset().mockReturnValue(true);
  importSolveHistoryMock.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/cf/verify/check", () => {
  it("returns 401 when signed out", async () => {
    ensureUserMock.mockResolvedValue(null);

    const res = await POST();

    expect(res.status).toBe(401);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("returns 404 when there is no pending verification", async () => {
    mockNoVerification();

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.ok).toBe(false);
  });

  it("returns 410 and clears the row when the verification has expired", async () => {
    mockVerificationRow({ expiresAt: new Date(NOW.getTime() - 1_000) });

    const res = await POST();

    expect(res.status).toBe(410);
    expect(deleteWhereMock).toHaveBeenCalledTimes(1);
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("returns 200 ok:false not_found_yet when no compile error is observed", async () => {
    mockVerificationRow();
    hasCompileErrorSinceMock.mockReturnValue(false);

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: false, error: "not_found_yet" });
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("links the handle and sets username = handle on success", async () => {
    mockVerificationRow({ handle: "tourist" });

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, cfHandle: "tourist", cfRating: 3500 });
    expect(updateSetMock).toHaveBeenCalledWith({
      cfHandle: "tourist",
      cfRating: 3500,
      cfLinkedAt: NOW,
      username: "tourist",
    });
    expect(deleteWhereMock).toHaveBeenCalledTimes(1);
  });

  it("uses the exact stored handle casing for both cfHandle and username", async () => {
    mockVerificationRow({ handle: "Radewoosh" });

    await POST();

    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ cfHandle: "Radewoosh", username: "Radewoosh" }),
    );
  });

  it("still links (with null rating) when the rating lookup fails", async () => {
    mockVerificationRow({ handle: "tourist" });
    const { CfApiError } = await import("@/lib/cf/client");
    getUserInfoMock.mockRejectedValue(new CfApiError("rate limited"));

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, cfHandle: "tourist", cfRating: null });
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ cfRating: null, username: "tourist" }),
    );
  });

  it("does not fail the link when solve-history import throws", async () => {
    mockVerificationRow({ handle: "tourist" });
    importSolveHistoryMock.mockRejectedValue(new Error("history sync down"));

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
  });

  it("returns 502 when the public API is unreachable", async () => {
    mockVerificationRow();
    getUserStatusMock.mockRejectedValue(new Error("network down"));

    const res = await POST();

    expect(res.status).toBe(502);
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the handle is already linked to another account (unique violation)", async () => {
    mockVerificationRow({ handle: "tourist" });
    updateWhereMock.mockRejectedValue({
      code: "23505",
      constraint: "users_cf_handle_unique",
    });

    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.ok).toBe(false);
    expect(deleteWhereMock).not.toHaveBeenCalled();
  });
});
