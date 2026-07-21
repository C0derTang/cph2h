/**
 * Tests for src/app/api/admin/reports/route.ts (issue #175).
 *
 * The load-bearing invariant per the issue: `requireAdmin` runs FIRST, and a
 * non-admin gets 404 (never reaching `listReports`).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSessionResult } from "@/lib/race/session";
import type { ReportDTO } from "@/lib/types";

const { requireAdminMock, listReportsMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn<() => Promise<AdminSessionResult>>(),
  listReportsMock: vi.fn<(status: string) => Promise<ReportDTO[]>>(),
}));

vi.mock("@/lib/race/session", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@/lib/admin/reports", () => ({
  listReports: listReportsMock,
  // Real implementation (pure, no db) — the route imports it directly.
  parseReportStatusFilter: (value: string | null) =>
    value === "open" || value === "resolved" || value === "all" ? value : "open",
}));
// `@/lib/ratelimit/policies` transitively imports the real `@/lib/db` (via
// `./db.ts`'s backend-registration side effect, issue #256) — mock it out.
vi.mock("@/lib/db", () => ({ db: {} }));

import { GET } from "@/app/api/admin/reports/route";

function req(query = ""): Request {
  return new Request(`http://localhost/api/admin/reports${query}`);
}

beforeEach(() => {
  requireAdminMock.mockReset();
  listReportsMock.mockReset();
});

describe("GET /api/admin/reports", () => {
  it("404s a non-admin without ever calling listReports", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, status: 404, error: "not_found" });

    const res = await GET(req());

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(listReportsMock).not.toHaveBeenCalled();
  });

  it("returns listReports' result for an admin, defaulting status to 'open'", async () => {
    requireAdminMock.mockResolvedValue({
      ok: true,
      user: { id: "admin-1" } as never,
    });
    listReportsMock.mockResolvedValue([{ id: "r1" } as unknown as ReportDTO]);

    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "r1" }]);
    expect(listReportsMock).toHaveBeenCalledWith("open");
  });

  it("passes through an explicit status query param", async () => {
    requireAdminMock.mockResolvedValue({ ok: true, user: { id: "admin-1" } as never });
    listReportsMock.mockResolvedValue([]);

    await GET(req("?status=resolved"));

    expect(listReportsMock).toHaveBeenCalledWith("resolved");
  });

  it("falls back to 'open' for an unrecognized status value", async () => {
    requireAdminMock.mockResolvedValue({ ok: true, user: { id: "admin-1" } as never });
    listReportsMock.mockResolvedValue([]);

    await GET(req("?status=bogus"));

    expect(listReportsMock).toHaveBeenCalledWith("open");
  });
});
