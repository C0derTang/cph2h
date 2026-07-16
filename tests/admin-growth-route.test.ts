/**
 * Tests for src/app/api/admin/growth/route.ts (issue #222).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSessionResult } from "@/lib/race/session";

const { requireAdminMock, getAdminGrowthMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn<() => Promise<AdminSessionResult>>(),
  getAdminGrowthMock: vi.fn(),
}));

vi.mock("@/lib/race/session", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@/lib/admin/growth", () => ({ getAdminGrowth: getAdminGrowthMock }));

import { GET } from "@/app/api/admin/growth/route";

beforeEach(() => {
  requireAdminMock.mockReset();
  getAdminGrowthMock.mockReset();
});

describe("GET /api/admin/growth", () => {
  it("404s a non-admin without calling getAdminGrowth", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, status: 404, error: "not_found" });

    const res = await GET();

    expect(res.status).toBe(404);
    expect(getAdminGrowthMock).not.toHaveBeenCalled();
  });

  it("200s with the growth payload for an admin", async () => {
    requireAdminMock.mockResolvedValue({ ok: true, user: { id: "admin-1" } as never });
    const growth = { signupsPerDay: [], registrationsPerDay: [] };
    getAdminGrowthMock.mockResolvedValue(growth);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(growth);
  });
});
