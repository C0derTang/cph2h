/**
 * Tests for src/app/api/admin/reports/[id]/evidence/route.ts (issue #175).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSessionResult } from "@/lib/race/session";

const { requireAdminMock, getReportEvidenceMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn<() => Promise<AdminSessionResult>>(),
  getReportEvidenceMock: vi.fn(),
}));

vi.mock("@/lib/race/session", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@/lib/admin/reports", () => ({ getReportEvidence: getReportEvidenceMock }));

import { GET } from "@/app/api/admin/reports/[id]/evidence/route";

const params = Promise.resolve({ id: "report-1" });

beforeEach(() => {
  requireAdminMock.mockReset();
  getReportEvidenceMock.mockReset();
});

describe("GET /api/admin/reports/[id]/evidence", () => {
  it("404s a non-admin without calling getReportEvidence", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, status: 404, error: "not_found" });

    const res = await GET(new Request("http://localhost"), { params });

    expect(res.status).toBe(404);
    expect(getReportEvidenceMock).not.toHaveBeenCalled();
  });

  it("404s when the report doesn't exist", async () => {
    requireAdminMock.mockResolvedValue({ ok: true, user: { id: "admin-1" } as never });
    getReportEvidenceMock.mockResolvedValue(null);

    const res = await GET(new Request("http://localhost"), { params });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("200s with the report + submissions for an admin", async () => {
    requireAdminMock.mockResolvedValue({ ok: true, user: { id: "admin-1" } as never });
    const evidence = { report: { id: "report-1" }, submissions: [] };
    getReportEvidenceMock.mockResolvedValue(evidence);

    const res = await GET(new Request("http://localhost"), { params });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(evidence);
    expect(getReportEvidenceMock).toHaveBeenCalledWith("report-1");
  });
});
