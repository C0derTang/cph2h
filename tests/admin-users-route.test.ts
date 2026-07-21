/**
 * Tests for src/app/api/admin/users/route.ts (issue #224).
 *
 * The load-bearing invariant per the issue: `requireAdmin` runs FIRST, and a
 * non-admin gets 404 (never reaching `listDirectoryUsers`).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSessionResult } from "@/lib/race/session";
import type { DirectoryUserDTO } from "@/lib/admin/directory";

const { requireAdminMock, listDirectoryUsersMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn<() => Promise<AdminSessionResult>>(),
  listDirectoryUsersMock: vi.fn<() => Promise<DirectoryUserDTO[]>>(),
}));

vi.mock("@/lib/race/session", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@/lib/admin/directory-db", () => ({
  listDirectoryUsers: listDirectoryUsersMock,
}));
// `@/lib/ratelimit/policies` transitively imports the real `@/lib/db` (via
// `./db.ts`'s backend-registration side effect, issue #256) — mock it out.
vi.mock("@/lib/db", () => ({ db: {} }));

import { GET } from "@/app/api/admin/users/route";

beforeEach(() => {
  requireAdminMock.mockReset();
  listDirectoryUsersMock.mockReset();
});

describe("GET /api/admin/users", () => {
  it("404s a non-admin without calling listDirectoryUsers", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, status: 404, error: "not_found" });

    const res = await GET();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(listDirectoryUsersMock).not.toHaveBeenCalled();
  });

  it("200s with the directory payload for an admin", async () => {
    requireAdminMock.mockResolvedValue({ ok: true, user: { id: "admin-1" } as never });
    const payload = [{ id: "u1" } as unknown as DirectoryUserDTO];
    listDirectoryUsersMock.mockResolvedValue(payload);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
  });
});
