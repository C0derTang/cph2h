/**
 * Tests for the admin gate in src/lib/race/session.ts (issue #175).
 *
 * `decideAdminAccess` is the pure decision (spec calls out unit-testing
 * "requireAdmin decision given a user row"): a missing user or a non-admin
 * row must both produce the same 404 — the load-bearing invariant is that a
 * non-admin gets no signal the admin surface exists. `requireAdmin` is the
 * thin wrapper over `ensureUser`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/lib/db/schema";

const { ensureUserMock } = vi.hoisted(() => ({ ensureUserMock: vi.fn() }));
vi.mock("@/lib/user", () => ({ ensureUser: ensureUserMock }));

import { decideAdminAccess, requireAdmin } from "@/lib/race/session";

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
    solveHistorySyncedAt: null,
    solveHistoryImportCursor: null,
    createdAt: null,
    isAdmin: false,
    ...overrides,
  };
}

beforeEach(() => {
  ensureUserMock.mockReset();
});

describe("decideAdminAccess", () => {
  it("404s a signed-out caller (null user)", () => {
    expect(decideAdminAccess(null)).toEqual({
      ok: false,
      status: 404,
      error: "not_found",
    });
  });

  it("404s a signed-in non-admin — same shape as a signed-out caller", () => {
    const nonAdmin = makeUser({ isAdmin: false });
    expect(decideAdminAccess(nonAdmin)).toEqual({
      ok: false,
      status: 404,
      error: "not_found",
    });
  });

  it("allows a signed-in admin, returning the user row", () => {
    const admin = makeUser({ isAdmin: true });
    expect(decideAdminAccess(admin)).toEqual({ ok: true, user: admin });
  });
});

describe("requireAdmin", () => {
  it("404s when ensureUser resolves null (signed-out)", async () => {
    ensureUserMock.mockResolvedValue(null);
    await expect(requireAdmin()).resolves.toEqual({
      ok: false,
      status: 404,
      error: "not_found",
    });
  });

  it("404s a linked-but-non-admin user", async () => {
    ensureUserMock.mockResolvedValue(makeUser({ cfLinkedAt: new Date(), isAdmin: false }));
    await expect(requireAdmin()).resolves.toEqual({
      ok: false,
      status: 404,
      error: "not_found",
    });
  });

  it("resolves ok for an admin user", async () => {
    const admin = makeUser({ isAdmin: true });
    ensureUserMock.mockResolvedValue(admin);
    await expect(requireAdmin()).resolves.toEqual({ ok: true, user: admin });
  });
});
