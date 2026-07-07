/**
 * Tests for src/app/api/settings/username/route.ts (issue #111).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MAX_USERNAME_LENGTH } from "../src/lib/username";

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

import { GET, PUT } from "../src/app/api/settings/username/route";

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
  return new Request("http://localhost/api/settings/username", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  authMock.mockReset();
  selectMock.mockReset();
  updateMock.mockReset();
});

describe("GET /api/settings/username", () => {
  it("returns 401 when signed out", async () => {
    authMock.mockResolvedValue({ userId: null });

    const res = await GET();

    expect(res.status).toBe(401);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("returns the saved username for a signed-in user", async () => {
    authMock.mockResolvedValue({ userId: "clerk-1" });
    mockSelectResult([{ username: "tourist" }]);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ username: "tourist" });
  });

  it("falls back to the default username when no user row exists", async () => {
    authMock.mockResolvedValue({ userId: "clerk-new" });
    mockSelectResult([]);

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ username: "racer" });
  });
});

describe("PUT /api/settings/username", () => {
  it("returns 401 when signed out", async () => {
    authMock.mockResolvedValue({ userId: null });

    const res = await PUT(makeRequest({ username: "tourist" }));

    expect(res.status).toBe(401);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("saves a valid username", async () => {
    authMock.mockResolvedValue({ userId: "clerk-1" });
    mockUpdateResult([{ username: "new-name" }]);

    const res = await PUT(makeRequest({ username: "new-name" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ username: "new-name" });
  });

  it("rejects a too-short username with 400", async () => {
    authMock.mockResolvedValue({ userId: "clerk-1" });

    const res = await PUT(makeRequest({ username: "a" }));

    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized username with 400", async () => {
    authMock.mockResolvedValue({ userId: "clerk-1" });

    const res = await PUT(
      makeRequest({ username: "a".repeat(MAX_USERNAME_LENGTH + 1) }),
    );

    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects a username containing @ with 400", async () => {
    authMock.mockResolvedValue({ userId: "clerk-1" });

    const res = await PUT(makeRequest({ username: "me@example.com" }));

    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed body with 400", async () => {
    authMock.mockResolvedValue({ userId: "clerk-1" });

    const res = await PUT(makeRequest({ notUsername: true }));

    expect(res.status).toBe(400);
  });

  it("returns 404 when the user has no row yet", async () => {
    authMock.mockResolvedValue({ userId: "clerk-new" });
    mockUpdateResult([]);

    const res = await PUT(makeRequest({ username: "new-name" }));

    expect(res.status).toBe(404);
  });
});
