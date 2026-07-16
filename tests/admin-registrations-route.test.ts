/**
 * Tests for src/app/api/admin/registrations/route.ts (issue #221).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSessionResult } from "@/lib/race/session";

const { requireAdminMock, listRegistrantsMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn<() => Promise<AdminSessionResult>>(),
  listRegistrantsMock: vi.fn(),
}));

vi.mock("@/lib/race/session", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@/lib/admin/registrants", () => ({ listRegistrants: listRegistrantsMock }));

import { GET } from "@/app/api/admin/registrations/route";

beforeEach(() => {
  requireAdminMock.mockReset();
  listRegistrantsMock.mockReset();
});

describe("GET /api/admin/registrations", () => {
  it("404s a non-admin without calling listRegistrants", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, status: 404, error: "not_found" });

    const res = await GET();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(listRegistrantsMock).not.toHaveBeenCalled();
  });

  it("200s with the registrants payload for an admin", async () => {
    requireAdminMock.mockResolvedValue({ ok: true, user: { id: "admin-1" } as never });
    const registrants = [{ userId: "user-1", username: "tourist" }];
    listRegistrantsMock.mockResolvedValue(registrants);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(registrants);
  });
});
