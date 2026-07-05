/**
 * Tests for src/app/api/settings/template/route.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MAX_TEMPLATE_LENGTH } from "../src/lib/editor/template";

const { authMock, selectMock, updateMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  selectMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: authMock,
}));

vi.mock("@/lib/db", () => ({
  db: { select: selectMock, update: updateMock },
}));

import { GET, PUT } from "../src/app/api/settings/template/route";

/** Queue up a single `db.select()...limit()` result. */
function mockSelectResult(rows: unknown[]) {
  selectMock.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(rows),
      }),
    }),
  }));
}

/** Queue up a single `db.update()...returning()` result. */
function mockUpdateResult(rows: unknown[]) {
  updateMock.mockImplementation(() => ({
    set: () => ({
      where: () => ({
        returning: () => Promise.resolve(rows),
      }),
    }),
  }));
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/settings/template", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  authMock.mockReset();
  selectMock.mockReset();
  updateMock.mockReset();
});

describe("GET /api/settings/template", () => {
  it("returns 401 when signed out", async () => {
    authMock.mockResolvedValue({ userId: null });

    const res = await GET();

    expect(res.status).toBe(401);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("returns the saved template for a signed-in user", async () => {
    authMock.mockResolvedValue({ userId: "clerk-1" });
    mockSelectResult([{ cppTemplate: "int main() { return 1; }" }]);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ template: "int main() { return 1; }" });
  });

  it("falls back to the default template when no user row exists", async () => {
    authMock.mockResolvedValue({ userId: "clerk-new" });
    mockSelectResult([]);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.template).toContain("int main()");
  });
});

describe("PUT /api/settings/template", () => {
  it("returns 401 when signed out", async () => {
    authMock.mockResolvedValue({ userId: null });

    const res = await PUT(makeRequest({ template: "x" }));

    expect(res.status).toBe(401);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("saves a valid template", async () => {
    authMock.mockResolvedValue({ userId: "clerk-1" });
    mockUpdateResult([{ cppTemplate: "int main() {}" }]);

    const res = await PUT(makeRequest({ template: "int main() {}" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ template: "int main() {}" });
  });

  it("rejects an oversized template with 400", async () => {
    authMock.mockResolvedValue({ userId: "clerk-1" });

    const res = await PUT(
      makeRequest({ template: "a".repeat(MAX_TEMPLATE_LENGTH + 1) }),
    );

    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed body with 400", async () => {
    authMock.mockResolvedValue({ userId: "clerk-1" });

    const res = await PUT(makeRequest({ notTemplate: true }));

    expect(res.status).toBe(400);
  });

  it("returns 404 when the user has no row yet", async () => {
    authMock.mockResolvedValue({ userId: "clerk-new" });
    mockUpdateResult([]);

    const res = await PUT(makeRequest({ template: "int main() {}" }));

    expect(res.status).toBe(404);
  });
});
