/**
 * Tests for src/app/api/admin/ops/route.ts (issue #223).
 *
 * The load-bearing invariant per the issue: `requireAdmin` runs FIRST, and a
 * non-admin gets 404 without ever calling `getAdminOps`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSessionResult } from "@/lib/race/session";
import type { AdminOps } from "@/lib/admin/ops";

const { requireAdminMock, getAdminOpsMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn<() => Promise<AdminSessionResult>>(),
  getAdminOpsMock: vi.fn<() => Promise<AdminOps>>(),
}));

vi.mock("@/lib/race/session", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@/lib/admin/ops", () => ({ getAdminOps: getAdminOpsMock }));
// `@/lib/ratelimit/policies` transitively imports the real `@/lib/db` (via
// `./db.ts`'s backend-registration side effect, issue #256) — mock it so no
// real db client construction is attempted in this suite (issue #257's
// `enforceAdminPolicy` only ever hits the in-memory backend here).
vi.mock("@/lib/db", () => ({ db: {} }));

import { GET } from "@/app/api/admin/ops/route";

beforeEach(() => {
  requireAdminMock.mockReset();
  getAdminOpsMock.mockReset();
});

describe("GET /api/admin/ops", () => {
  it("404s a non-admin without calling getAdminOps", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, status: 404, error: "not_found" });

    const res = await GET();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(getAdminOpsMock).not.toHaveBeenCalled();
  });

  it("200s with the ops payload for an admin", async () => {
    requireAdminMock.mockResolvedValue({ ok: true, user: { id: "admin-1" } as never });
    const ops: AdminOps = { queueDepth: 2, activeRaces: 1, recentRaces: [] };
    getAdminOpsMock.mockResolvedValue(ops);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(ops);
    expect(getAdminOpsMock).toHaveBeenCalledOnce();
  });
});
