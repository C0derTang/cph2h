/**
 * Tests for src/app/api/admin/races/[id]/end/route.ts POST (issue #296).
 *
 * Follows the `tests/admin-report-resolve-route.test.ts` idiom (hoisted
 * `requireAdmin` mock, 404-before-work) plus the db-chain mock shape of
 * `tests/race-snapshot-route.test.ts`, extended with an `update().set().
 * where().returning()` chain for the atomic abort claim.
 *
 * Load-bearing pins:
 *  - non-admin → 404 before ANY db work;
 *  - invalid body → 400;
 *  - terminal race → 409 (no db mutation, no finishRace);
 *  - abort success → publishes `aborted`, NEVER calls finishRace (no Elo);
 *  - declare_winner → delegates to finishRace with {outcome, winnerId,
 *    reason:"forfeit"} (the sole Elo mutex);
 *  - empty `.returning()` on the abort claim → 409.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSessionResult } from "@/lib/race/session";

const {
  requireAdminMock,
  enforceAdminPolicyMock,
  finishRaceMock,
  publishRaceEventMock,
  dbState,
} = vi.hoisted(() => {
  const dbState = {
    selectResults: [] as unknown[][],
    selectIndex: 0,
    updateResults: [] as unknown[][],
    updateIndex: 0,
  };
  return {
    requireAdminMock: vi.fn<() => Promise<AdminSessionResult>>(),
    enforceAdminPolicyMock: vi.fn().mockResolvedValue(null),
    finishRaceMock: vi.fn().mockResolvedValue(undefined),
    publishRaceEventMock: vi.fn().mockResolvedValue(undefined),
    dbState,
  };
});

vi.mock("@/lib/race/session", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@/lib/ratelimit/policies", () => ({
  enforceAdminPolicy: enforceAdminPolicyMock,
}));
vi.mock("@/lib/race/hooks", () => ({
  finishRace: finishRaceMock,
  publishRaceEvent: publishRaceEventMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve(dbState.selectResults[dbState.selectIndex++] ?? []),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () =>
            Promise.resolve(dbState.updateResults[dbState.updateIndex++] ?? []),
        }),
      }),
    }),
  },
}));

import { POST } from "@/app/api/admin/races/[id]/end/route";

const RACE_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const P1 = "user-p1";
const P2 = "user-p2";

const params = Promise.resolve({ id: RACE_ID });

function req(body: unknown): Request {
  return new Request(`http://localhost/api/admin/races/${RACE_ID}/end`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function adminOk() {
  requireAdminMock.mockResolvedValue({
    ok: true,
    user: { id: "admin-1" } as never,
  });
}

beforeEach(() => {
  requireAdminMock.mockReset();
  enforceAdminPolicyMock.mockReset().mockResolvedValue(null);
  finishRaceMock.mockReset().mockResolvedValue(undefined);
  publishRaceEventMock.mockReset().mockResolvedValue(undefined);
  dbState.selectResults = [];
  dbState.selectIndex = 0;
  dbState.updateResults = [];
  dbState.updateIndex = 0;
});

describe("POST /api/admin/races/[id]/end — auth + validation", () => {
  it("404s a non-admin BEFORE any db work", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, status: 404, error: "not_found" });

    const res = await POST(req({ action: "abort" }), { params });

    expect(res.status).toBe(404);
    expect(dbState.selectIndex).toBe(0);
    expect(dbState.updateIndex).toBe(0);
    expect(finishRaceMock).not.toHaveBeenCalled();
    expect(publishRaceEventMock).not.toHaveBeenCalled();
  });

  it("400s an invalid body", async () => {
    adminOk();

    const res = await POST(req({ action: "nonsense" }), { params });

    expect(res.status).toBe(400);
    expect(dbState.selectIndex).toBe(0);
    expect(finishRaceMock).not.toHaveBeenCalled();
  });

  it("404s when the race does not exist", async () => {
    adminOk();
    dbState.selectResults = [[]];

    const res = await POST(req({ action: "abort" }), { params });

    expect(res.status).toBe(404);
  });
});

describe("POST /api/admin/races/[id]/end — terminal race", () => {
  it("409s a finished race and never mutates or applies Elo", async () => {
    adminOk();
    dbState.selectResults = [[{ status: "finished", p1Id: P1, p2Id: P2 }]];

    const res = await POST(req({ action: "abort" }), { params });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already_terminal" });
    expect(dbState.updateIndex).toBe(0);
    expect(finishRaceMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/races/[id]/end — abort", () => {
  it("aborts an active race, publishes `aborted`, and NEVER calls finishRace", async () => {
    adminOk();
    const finishedAt = new Date("2026-07-01T00:05:00.000Z");
    dbState.selectResults = [[{ status: "active", p1Id: P1, p2Id: P2 }]];
    dbState.updateResults = [
      [
        {
          id: RACE_ID,
          status: "aborted",
          outcome: "aborted",
          winnerId: null,
          finishedAt,
        },
      ],
    ];

    const res = await POST(req({ action: "abort" }), { params });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: RACE_ID,
      status: "aborted",
      outcome: "aborted",
      winnerId: null,
      finishedAt: finishedAt.toISOString(),
    });
    expect(finishRaceMock).not.toHaveBeenCalled();
    expect(publishRaceEventMock).toHaveBeenCalledWith(RACE_ID, {
      type: "aborted",
      byUserId: "admin-1",
    });
  });

  it("409s when the atomic abort claim returns zero rows", async () => {
    adminOk();
    dbState.selectResults = [[{ status: "active", p1Id: P1, p2Id: P2 }]];
    dbState.updateResults = [[]]; // lost the claim

    const res = await POST(req({ action: "abort" }), { params });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "conflict" });
    expect(publishRaceEventMock).not.toHaveBeenCalled();
    expect(finishRaceMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/races/[id]/end — declare_winner", () => {
  it("delegates to finishRace with the correct payload and 200s on a finished re-read", async () => {
    adminOk();
    const finishedAt = new Date("2026-07-01T00:05:00.000Z");
    // First select: the active race. Second select: the finished re-read.
    dbState.selectResults = [
      [{ status: "active", p1Id: P1, p2Id: P2 }],
      [
        {
          id: RACE_ID,
          status: "finished",
          outcome: "p1_win",
          winnerId: P1,
          finishedAt,
        },
      ],
    ];

    const res = await POST(
      req({ action: "declare_winner", winnerId: P1 }),
      { params },
    );

    expect(res.status).toBe(200);
    expect(finishRaceMock).toHaveBeenCalledWith({
      raceId: RACE_ID,
      outcome: "p1_win",
      winnerId: P1,
      reason: "forfeit",
    });
    expect(await res.json()).toEqual({
      id: RACE_ID,
      status: "finished",
      outcome: "p1_win",
      winnerId: P1,
      finishedAt: finishedAt.toISOString(),
    });
    // The abort claim path must not have run.
    expect(dbState.updateIndex).toBe(0);
    expect(publishRaceEventMock).not.toHaveBeenCalled();
  });

  it("declares p2 the winner with outcome p2_win", async () => {
    adminOk();
    dbState.selectResults = [
      [{ status: "active", p1Id: P1, p2Id: P2 }],
      [{ id: RACE_ID, status: "finished", outcome: "p2_win", winnerId: P2, finishedAt: null }],
    ];

    const res = await POST(
      req({ action: "declare_winner", winnerId: P2 }),
      { params },
    );

    expect(res.status).toBe(200);
    expect(finishRaceMock).toHaveBeenCalledWith({
      raceId: RACE_ID,
      outcome: "p2_win",
      winnerId: P2,
      reason: "forfeit",
    });
  });

  it("400s an invalid winner id without calling finishRace", async () => {
    adminOk();
    dbState.selectResults = [[{ status: "active", p1Id: P1, p2Id: P2 }]];

    const res = await POST(
      req({ action: "declare_winner", winnerId: "stranger" }),
      { params },
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_winner" });
    expect(finishRaceMock).not.toHaveBeenCalled();
  });

  it("409s when the re-read is not finished (lost a TOCTOU to a concurrent abort)", async () => {
    adminOk();
    dbState.selectResults = [
      [{ status: "active", p1Id: P1, p2Id: P2 }],
      [{ id: RACE_ID, status: "aborted", outcome: "aborted", winnerId: null, finishedAt: null }],
    ];

    const res = await POST(
      req({ action: "declare_winner", winnerId: P1 }),
      { params },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "conflict" });
    expect(finishRaceMock).toHaveBeenCalledTimes(1);
  });

  it("409s a non-active race (declare_winner requires active)", async () => {
    adminOk();
    dbState.selectResults = [[{ status: "ready", p1Id: P1, p2Id: P2 }]];

    const res = await POST(
      req({ action: "declare_winner", winnerId: P1 }),
      { params },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not_active" });
    expect(finishRaceMock).not.toHaveBeenCalled();
  });
});
