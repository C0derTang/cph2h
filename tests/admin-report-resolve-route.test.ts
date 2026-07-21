/**
 * Tests for src/app/api/admin/reports/[id]/route.ts PATCH (issue #175).
 *
 * Pins: requireAdmin runs first (404 for non-admins before touching the
 * body or the db); body validation (400 for anything but
 * `{ status: "resolved" }`); the atomic-claim 409 when resolveReport
 * returns null (already resolved / nonexistent id).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSessionResult } from "@/lib/race/session";
import type { ReportDTO } from "@/lib/types";

const { requireAdminMock, resolveReportMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn<() => Promise<AdminSessionResult>>(),
  resolveReportMock: vi.fn<(id: string) => Promise<ReportDTO | null>>(),
}));

vi.mock("@/lib/race/session", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@/lib/admin/reports", () => ({ resolveReport: resolveReportMock }));
// `@/lib/ratelimit/policies` transitively imports the real `@/lib/db` (via
// `./db.ts`'s backend-registration side effect, issue #256) — mock it out.
vi.mock("@/lib/db", () => ({ db: {} }));

import { PATCH } from "@/app/api/admin/reports/[id]/route";

const params = Promise.resolve({ id: "report-1" });

function req(body?: unknown): Request {
  return new Request("http://localhost/api/admin/reports/report-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? { status: "resolved" }),
  });
}

beforeEach(() => {
  requireAdminMock.mockReset();
  resolveReportMock.mockReset();
});

describe("PATCH /api/admin/reports/[id]", () => {
  it("404s a non-admin without touching the body or resolveReport", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, status: 404, error: "not_found" });

    const res = await PATCH(req(), { params });

    expect(res.status).toBe(404);
    expect(resolveReportMock).not.toHaveBeenCalled();
  });

  it("400s a body that isn't { status: 'resolved' }", async () => {
    requireAdminMock.mockResolvedValue({ ok: true, user: { id: "admin-1" } as never });

    const res = await PATCH(req({ status: "open" }), { params });

    expect(res.status).toBe(400);
    expect(resolveReportMock).not.toHaveBeenCalled();
  });

  it("409s when the atomic claim loses (resolveReport returns null)", async () => {
    requireAdminMock.mockResolvedValue({ ok: true, user: { id: "admin-1" } as never });
    resolveReportMock.mockResolvedValue(null);

    const res = await PATCH(req(), { params });

    expect(res.status).toBe(409);
  });

  it("200s with the resolved DTO on success", async () => {
    requireAdminMock.mockResolvedValue({ ok: true, user: { id: "admin-1" } as never });
    const dto = { id: "report-1", status: "resolved" } as unknown as ReportDTO;
    resolveReportMock.mockResolvedValue(dto);

    const res = await PATCH(req(), { params });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(dto);
    expect(resolveReportMock).toHaveBeenCalledWith("report-1");
  });
});
