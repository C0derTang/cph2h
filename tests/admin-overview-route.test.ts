/**
 * Tests for src/app/api/admin/overview/route.ts (issue #175).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSessionResult } from "@/lib/race/session";

const { requireAdminMock, getAdminOverviewMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn<() => Promise<AdminSessionResult>>(),
  getAdminOverviewMock: vi.fn(),
}));

vi.mock("@/lib/race/session", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@/lib/admin/overview", () => ({ getAdminOverview: getAdminOverviewMock }));
// `@/lib/ratelimit/policies` transitively imports the real `@/lib/db` (via
// `./db.ts`'s backend-registration side effect, issue #256) — mock it out.
vi.mock("@/lib/db", () => ({ db: {} }));

import { GET } from "@/app/api/admin/overview/route";

beforeEach(() => {
  requireAdminMock.mockReset();
  getAdminOverviewMock.mockReset();
});

describe("GET /api/admin/overview", () => {
  it("404s a non-admin without calling getAdminOverview", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, status: 404, error: "not_found" });

    const res = await GET();

    expect(res.status).toBe(404);
    expect(getAdminOverviewMock).not.toHaveBeenCalled();
  });

  it("200s with the overview for an admin", async () => {
    requireAdminMock.mockResolvedValue({ ok: true, user: { id: "admin-1" } as never });
    const overview = { totalUsers: 5 };
    getAdminOverviewMock.mockResolvedValue(overview);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(overview);
  });
});
