/**
 * Tests for src/app/api/races/[id]/ready/route.ts (issue #66 no-match path).
 *
 * `requireLinkedUser`, `db`, `selectRaceProblem`/`publishRaceEvent`
 * (`@/lib/race/hooks`), and `buildRaceSnapshot` are mocked; the REAL pure
 * machine guards (`@/lib/race/machine`) run. The load-bearing invariant pinned
 * here: a race NEVER transitions to `active` when problem selection fails — no
 * update ever sets `status: 'active'` or a problem id on the no-match path, the
 * ready flags reset, and the failure reason is persisted. The success path
 * still transitions with a concrete, non-null problem id.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Race } from "../src/lib/db/schema";
import type { SessionResult } from "../src/lib/race/session";
import type { SelectProblemResult } from "../src/lib/types";

const {
  requireLinkedUserMock,
  selectRaceProblemMock,
  publishRaceEventMock,
  refreshSeenProblemsMock,
  buildRaceSnapshotMock,
  updateSetMock,
  dbState,
} = vi.hoisted(() => {
  const dbState = {
    selectResults: [] as unknown[][],
    selectIndex: 0,
    updateReturns: [] as unknown[][],
    updateIndex: 0,
    // Rows returned by the (un-limited) users lookup the ready route makes
    // before selection to feed the solve-history refresh (issue #69).
    playerRows: [] as unknown[],
  };
  return {
    requireLinkedUserMock: vi.fn<() => Promise<SessionResult>>(),
    selectRaceProblemMock: vi.fn<() => Promise<SelectProblemResult>>(),
    publishRaceEventMock: vi.fn().mockResolvedValue(undefined),
    refreshSeenProblemsMock: vi.fn().mockResolvedValue(undefined),
    buildRaceSnapshotMock: vi.fn(async (race: Race) => ({
      __snapshotFor: race.id,
      status: race.status,
      problemId: race.problemId,
      problemSelectionFailedReason: race.problemSelectionFailedReason,
    })),
    updateSetMock: vi.fn(),
    dbState,
  };
});

vi.mock("@/lib/race/session", () => ({ requireLinkedUser: requireLinkedUserMock }));
vi.mock("@/lib/race/hooks", () => ({
  selectRaceProblem: selectRaceProblemMock,
  publishRaceEvent: publishRaceEventMock,
  refreshSeenProblems: refreshSeenProblemsMock,
}));
vi.mock("@/lib/race/snapshot", () => ({ buildRaceSnapshot: buildRaceSnapshotMock }));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          // Two call shapes share this mock: the race-by-id lookups
          // (`.where(...).limit(1)`, queued via `dbState.selectResults`) and
          // the un-limited users lookup the ready route makes before
          // solve-history refresh (`await db...where(...)` directly — no
          // `.limit()`). Support both: `.limit()` for the former, and make
          // the returned object itself thenable so a bare `await` resolves
          // to `dbState.playerRows` for the latter.
          return {
            limit: () =>
              Promise.resolve(dbState.selectResults[dbState.selectIndex++] ?? []),
            then: (
              resolve: (value: unknown[]) => void,
              reject?: (reason: unknown) => void,
            ) => Promise.resolve(dbState.playerRows).then(resolve, reject),
          };
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updateSetMock(values);
        return {
          where: () => ({
            returning: () =>
              Promise.resolve(dbState.updateReturns[dbState.updateIndex++] ?? []),
          }),
        };
      },
    }),
  },
}));

import { POST } from "../src/app/api/races/[id]/ready/route";

const RACE_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const P1 = "user-p1";
const P2 = "user-p2";

function makeRace(overrides: Partial<Race> = {}): Race {
  return {
    id: RACE_ID,
    status: "ready",
    challengeToken: null,
    p1Id: P1,
    p2Id: P2,
    p1Ready: false,
    p2Ready: false,
    problemId: null,
    timeLimitSec: 2400,
    startedAt: null,
    endsAt: null,
    finishedAt: null,
    outcome: null,
    winnerId: null,
    winningSubmissionId: null,
    eloDeltaP1: null,
    eloDeltaP2: null,
    lastPolledAt: null,
    p1LastSeenAt: null,
    p2LastSeenAt: null,
    ratingMin: null,
    ratingMax: null,
    problemDateFrom: null,
    problemDateTo: null,
    problemSelectionFailedReason: null,
    livekitRoom: "room-1",
    drawOfferBy: null,
    createdAt: null,
    ...overrides,
  };
}

function queueSelects(results: unknown[][]) {
  dbState.selectResults = results;
  dbState.selectIndex = 0;
}
function queueUpdates(results: unknown[][]) {
  dbState.updateReturns = results;
  dbState.updateIndex = 0;
}

const params = Promise.resolve({ id: RACE_ID });

function req(): Request {
  return new Request(`http://localhost/api/races/${RACE_ID}/ready`, { method: "POST" });
}

function mockSessionAs(userId: string) {
  requireLinkedUserMock.mockResolvedValue({
    ok: true,
    user: {
      id: userId,
      clerkId: `clerk-${userId}`,
      username: userId,
      cfHandle: `${userId}cf`,
      cfRating: 1400,
      cfLinkedAt: new Date(),
      elo: 1200,
      racesPlayed: 3,
      cppTemplate: "",
      solveHistorySyncedAt: null,
      solveHistoryImportCursor: null,
      createdAt: null,
    },
  });
}

beforeEach(() => {
  vi.useRealTimers();
  requireLinkedUserMock.mockReset();
  selectRaceProblemMock.mockReset();
  publishRaceEventMock.mockClear();
  refreshSeenProblemsMock.mockClear();
  refreshSeenProblemsMock.mockResolvedValue(undefined);
  buildRaceSnapshotMock.mockClear();
  updateSetMock.mockClear();
  dbState.selectResults = [];
  dbState.selectIndex = 0;
  dbState.updateReturns = [];
  dbState.updateIndex = 0;
  dbState.playerRows = [];
  mockSessionAs(P1);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/races/[id]/ready — success path", () => {
  it("transitions ready -> active with a concrete non-null problem id", async () => {
    const race = makeRace({ p2Ready: true }); // opponent already ready
    const afterReady = { ...race, p1Ready: true };
    const started = {
      ...afterReady,
      status: "active" as const,
      problemId: "1794C",
    };
    dbState.playerRows = [
      { id: P1, cfHandle: "p1cf", solveHistorySyncedAt: null, solveHistoryImportCursor: null },
      { id: P2, cfHandle: "p2cf", solveHistorySyncedAt: null, solveHistoryImportCursor: null },
    ];
    queueSelects([[race]]);
    queueUpdates([[afterReady], [started]]);
    selectRaceProblemMock.mockResolvedValue({ ok: true, problemId: "1794C" });

    const res = await POST(req(), { params });

    expect(res.status).toBe(200);
    expect(selectRaceProblemMock).toHaveBeenCalledTimes(1);
    // Solve-history refresh (issue #69) runs for both players before selection.
    expect(refreshSeenProblemsMock).toHaveBeenCalledTimes(2);
    expect(refreshSeenProblemsMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: P1 }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(refreshSeenProblemsMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: P2 }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    // The transition update carries a real problem id and clears any reason.
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "active",
        problemId: "1794C",
        problemSelectionFailedReason: null,
      }),
    );
    expect(publishRaceEventMock).toHaveBeenCalledWith(
      RACE_ID,
      expect.objectContaining({ type: "countdown" }),
    );
  });

  it("clears a stale failure reason as the ready attempt begins", async () => {
    const race = makeRace({ p2Ready: false, problemSelectionFailedReason: "all_problems_seen" });
    queueSelects([[race]]);
    queueUpdates([[{ ...race, p1Ready: true }]]); // still not both ready
    selectRaceProblemMock.mockResolvedValue({ ok: true, problemId: "x" });

    await POST(req(), { params });

    // First (only) update sets the caller's flag AND nulls the stale reason.
    expect(updateSetMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ p1Ready: true, problemSelectionFailedReason: null }),
    );
    // Not both ready -> selection is never attempted.
    expect(selectRaceProblemMock).not.toHaveBeenCalled();
    // ...and the solve-history refresh (only meaningful right before
    // selection) is never attempted either.
    expect(refreshSeenProblemsMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/races/[id]/ready — solve-history refresh (issue #69)", () => {
  it("never blocks or fails the ready path when the refresh rejects", async () => {
    const race = makeRace({ p2Ready: true });
    const afterReady = { ...race, p1Ready: true };
    const started = { ...afterReady, status: "active" as const, problemId: "1794C" };
    dbState.playerRows = [
      { id: P1, cfHandle: "p1cf", solveHistorySyncedAt: null, solveHistoryImportCursor: null },
      { id: P2, cfHandle: "p2cf", solveHistorySyncedAt: null, solveHistoryImportCursor: null },
    ];
    queueSelects([[race]]);
    queueUpdates([[afterReady], [started]]);
    selectRaceProblemMock.mockResolvedValue({ ok: true, problemId: "1794C" });
    refreshSeenProblemsMock.mockRejectedValue(new Error("cf is down"));

    const res = await POST(req(), { params });

    expect(res.status).toBe(200);
    expect(selectRaceProblemMock).toHaveBeenCalledTimes(1);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "active", problemId: "1794C" }),
    );
  });

  it("proceeds to selection even when the refresh call throws synchronously", async () => {
    const race = makeRace({ p2Ready: true });
    const afterReady = { ...race, p1Ready: true };
    const started = { ...afterReady, status: "active" as const, problemId: "1794C" };
    dbState.playerRows = [{ id: P1, cfHandle: "p1cf", solveHistorySyncedAt: null }];
    queueSelects([[race]]);
    queueUpdates([[afterReady], [started]]);
    selectRaceProblemMock.mockResolvedValue({ ok: true, problemId: "1794C" });
    // Simulate a hook implementation bug/failure that throws synchronously
    // rather than rejecting — the route's try/catch must still swallow it.
    refreshSeenProblemsMock.mockImplementation(() => {
      throw new Error("boom");
    });

    const res = await POST(req(), { params });

    expect(res.status).toBe(200);
    expect(selectRaceProblemMock).toHaveBeenCalledTimes(1);
  });

  it("aborts queued refreshes when the ready-path soft budget expires", async () => {
    vi.useFakeTimers();
    const race = makeRace({ p2Ready: true });
    const afterReady = { ...race, p1Ready: true };
    const started = { ...afterReady, status: "active" as const, problemId: "1794C" };
    dbState.playerRows = [
      { id: P1, cfHandle: "p1cf", solveHistorySyncedAt: null, solveHistoryImportCursor: null },
      { id: P2, cfHandle: "p2cf", solveHistorySyncedAt: null, solveHistoryImportCursor: null },
    ];
    queueSelects([[race]]);
    queueUpdates([[afterReady], [started]]);
    selectRaceProblemMock.mockResolvedValue({ ok: true, problemId: "1794C" });

    const signals: AbortSignal[] = [];
    refreshSeenProblemsMock.mockImplementation((_player, options?: { signal?: AbortSignal }) => {
      if (options?.signal) signals.push(options.signal);
      return new Promise<void>((resolve) => {
        options?.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    });

    const pending = POST(req(), { params });
    await vi.advanceTimersByTimeAsync(0);
    expect(signals).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(3499);
    expect(selectRaceProblemMock).not.toHaveBeenCalled();
    expect(signals.every((signal) => !signal.aborted)).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    const res = await pending;

    expect(res.status).toBe(200);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(selectRaceProblemMock).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/races/[id]/ready — no-match path (issue #66)", () => {
  it("does NOT transition to active; resets ready flags and persists the reason", async () => {
    const race = makeRace({ p2Ready: true });
    const afterReady = { ...race, p1Ready: true };
    const reset = {
      ...race,
      p1Ready: false,
      p2Ready: false,
      problemSelectionFailedReason: "all_problems_seen" as const,
    };
    queueSelects([[race]]);
    queueUpdates([[afterReady], [reset]]);
    selectRaceProblemMock.mockResolvedValue({ ok: false, reason: "all_problems_seen" });

    const res = await POST(req(), { params });

    expect(res.status).toBe(200);
    // INVARIANT: no update ever sets status:'active' or a problem id.
    for (const call of updateSetMock.mock.calls) {
      const values = call[0] as Record<string, unknown>;
      expect(values.status).not.toBe("active");
      expect(values).not.toHaveProperty("problemId");
    }
    // The reset update resets both flags and persists the reason.
    expect(updateSetMock).toHaveBeenNthCalledWith(2, {
      p1Ready: false,
      p2Ready: false,
      problemSelectionFailedReason: "all_problems_seen",
    });
    expect(publishRaceEventMock).toHaveBeenCalledWith(RACE_ID, {
      type: "problem_selection_failed",
      reason: "all_problems_seen",
    });
    // Snapshot reflects the reset row (still in the lobby).
    const json = (await res.json()) as { status: string; problemSelectionFailedReason: string };
    expect(json.status).toBe("ready");
    expect(json.problemSelectionFailedReason).toBe("all_problems_seen");
  });

  it("propagates no_problems_in_filters likewise", async () => {
    const race = makeRace({ p2Ready: true, ratingMin: 3500, ratingMax: 3500 });
    const afterReady = { ...race, p1Ready: true };
    const reset = {
      ...race,
      p1Ready: false,
      p2Ready: false,
      problemSelectionFailedReason: "no_problems_in_filters" as const,
    };
    queueSelects([[race]]);
    queueUpdates([[afterReady], [reset]]);
    selectRaceProblemMock.mockResolvedValue({ ok: false, reason: "no_problems_in_filters" });

    const res = await POST(req(), { params });

    expect(res.status).toBe(200);
    expect(publishRaceEventMock).toHaveBeenCalledWith(RACE_ID, {
      type: "problem_selection_failed",
      reason: "no_problems_in_filters",
    });
  });

  it("re-reads and does not double-select when the reset claim is lost (concurrent start)", async () => {
    const race = makeRace({ p2Ready: true });
    const afterReady = { ...race, p1Ready: true };
    queueSelects([[race], [{ ...afterReady, status: "active" }]]);
    queueUpdates([[afterReady], []]); // reset update loses the status='ready' claim
    selectRaceProblemMock.mockResolvedValue({ ok: false, reason: "all_problems_seen" });

    const res = await POST(req(), { params });

    expect(res.status).toBe(200);
    // No failure event published on a lost claim (the snapshot is the truth).
    expect(publishRaceEventMock).not.toHaveBeenCalledWith(
      RACE_ID,
      expect.objectContaining({ type: "problem_selection_failed" }),
    );
  });
});

describe("POST /api/races/[id]/ready — guards", () => {
  it("returns 404 when the race does not exist", async () => {
    queueSelects([[]]);
    const res = await POST(req(), { params });
    expect(res.status).toBe(404);
    expect(selectRaceProblemMock).not.toHaveBeenCalled();
  });

  it("returns 409 when not in the ready phase", async () => {
    queueSelects([[makeRace({ status: "pending" })]]);
    const res = await POST(req(), { params });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_ready_phase");
    expect(updateSetMock).not.toHaveBeenCalled();
  });
});
