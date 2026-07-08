/**
 * Tests for the ready-time incremental solve-history refresh (issue #69,
 * always-refresh fix #98):
 *  - `isSolveHistoryStale` — the pure staleness predicate.
 *  - `importSolveHistoryIncremental` — pagination cutoff over fake
 *    `user.status` pages: stops at the first submission older than
 *    `syncedAt`, respects the incremental page cap, and a null `syncedAt`
 *    falls back to the full import path.
 *  - `refreshSolveHistoryIfStale` — no-op when fresh/unlinked, never throws.
 *  - `refreshSolveHistoryForce` (issue #98) — used on the both-ready path:
 *    always refreshes (even when `syncedAt` is fresh) so a problem solved
 *    moments ago is excluded from this selection; still no-ops when
 *    unlinked, and still never throws when CF is down.
 *
 * `@/lib/cf/client` and `@/lib/db` are mocked (no network/DB); the pagination
 * loop and staleness math are the real implementation under test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CfSubmission } from "../src/lib/types";
import { SOLVE_HISTORY_STALE_SEC } from "../src/lib/types";

const { getUserStatusMock, dbState } = vi.hoisted(() => {
  const dbState = {
    /** `problems` rows considered already catalogued (FK-safe). */
    knownProblemIds: new Set<string>(),
    insertBatches: [] as unknown[][],
    updateCalls: [] as { table: unknown; values: Record<string, unknown> }[],
  };
  return {
    getUserStatusMock: vi.fn<(handle: string, from?: number, count?: number) => Promise<CfSubmission[]>>(),
    dbState,
  };
});

vi.mock("@/lib/cf/client", () => ({ getUserStatus: getUserStatusMock }));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () =>
          Promise.resolve(
            [...dbState.knownProblemIds].map((id) => ({ id })),
          ),
      }),
    }),
    insert: () => ({
      values: (batch: unknown[]) => {
        dbState.insertBatches.push(batch);
        return {
          onConflictDoUpdate: () => Promise.resolve(),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        dbState.updateCalls.push({ table, values });
        return { where: () => Promise.resolve() };
      },
    }),
  },
}));

import { importSolveHistoryIncremental } from "../src/lib/cf/history";
import {
  isSolveHistoryStale,
  refreshSolveHistoryForce,
  refreshSolveHistoryIfStale,
} from "../src/lib/cf/history-refresh";

const USER_ID = "user-1";
const HANDLE = "tourist";

/** Build a fake submission at `creationTimeSeconds`, solving a distinct problem. */
function sub(problemSeq: number, creationTimeSeconds: number, verdict = "OK"): CfSubmission {
  return {
    id: problemSeq,
    contestId: 1000,
    creationTimeSeconds,
    problem: { contestId: 1000, index: String.fromCharCode(65 + (problemSeq % 26)) },
    author: { members: [{ handle: HANDLE }] },
    programmingLanguage: "GNU C++17",
    verdict,
  } as CfSubmission;
}

/** A full 1000-submission page, all newer than `baseTime`, none hitting any cutoff. */
function fullPage(pageIndex: number, baseTime: number): CfSubmission[] {
  const page: CfSubmission[] = [];
  for (let i = 0; i < 1000; i++) {
    const seq = pageIndex * 1000 + i;
    page.push(sub(seq, baseTime - seq));
  }
  return page;
}

beforeEach(() => {
  getUserStatusMock.mockReset();
  dbState.knownProblemIds = new Set();
  dbState.insertBatches = [];
  dbState.updateCalls = [];
});

describe("isSolveHistoryStale", () => {
  it("is stale when never synced (null)", () => {
    expect(isSolveHistoryStale(null)).toBe(true);
  });

  it("is fresh just under the staleness window", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const syncedAt = new Date(now.getTime() - (SOLVE_HISTORY_STALE_SEC - 1) * 1000);
    expect(isSolveHistoryStale(syncedAt, now)).toBe(false);
  });

  it("is stale at and beyond the staleness window", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const atBoundary = new Date(now.getTime() - SOLVE_HISTORY_STALE_SEC * 1000);
    const pastBoundary = new Date(now.getTime() - (SOLVE_HISTORY_STALE_SEC + 1) * 1000);
    expect(isSolveHistoryStale(atBoundary, now)).toBe(true);
    expect(isSolveHistoryStale(pastBoundary, now)).toBe(true);
  });
});

describe("importSolveHistoryIncremental — pagination cutoff", () => {
  it("stops at the first submission older than syncedAt and fetches only one page", async () => {
    const cutoffSec = 1000;
    const syncedAt = new Date(cutoffSec * 1000);
    // 4 submissions newer than the cutoff, then one older — the older one
    // (and anything after it) must not be recorded.
    const page = [
      sub(1, 2000),
      sub(2, 1900),
      sub(3, 1800),
      sub(4, 1200),
      sub(5, 900), // older than cutoffSec=1000 -> stop here
      sub(6, 800),
    ];
    getUserStatusMock.mockResolvedValueOnce(page);
    dbState.knownProblemIds = new Set(page.map((s) => `${s.problem.contestId}${s.problem.index}`));

    await importSolveHistoryIncremental(USER_ID, HANDLE, syncedAt);

    // Only the first page was ever fetched — the cutoff was hit within it.
    expect(getUserStatusMock).toHaveBeenCalledTimes(1);
    expect(getUserStatusMock).toHaveBeenCalledWith(HANDLE, 1, 1000);

    const recordedProblemIds = [
      ...new Set(
        dbState.insertBatches.flat().map((row) => (row as { problemId: string }).problemId),
      ),
    ];
    // Submissions 1-4 (times 2000..1200) are within range; 5-6 are cut off.
    for (const s of page.slice(0, 4)) {
      expect(recordedProblemIds).toContain(`${s.problem.contestId}${s.problem.index}`);
    }
    for (const s of page.slice(4)) {
      expect(recordedProblemIds).not.toContain(`${s.problem.contestId}${s.problem.index}`);
    }

    // Stamps solveHistorySyncedAt on success.
    expect(dbState.updateCalls).toHaveLength(1);
    expect(dbState.updateCalls[0].values.solveHistorySyncedAt).toBeInstanceOf(Date);
  });

  it("respects the incremental page cap even when the cutoff is never reached", async () => {
    const veryOldSyncedAt = new Date(0); // cutoff so old it's never hit
    getUserStatusMock.mockImplementation((_handle, from = 1) => {
      const pageIndex = Math.floor((from - 1) / 1000);
      // Every page is full (1000 rows) and would-be page 3 exists too, but
      // must never be requested — the incremental cap is 2 pages.
      return Promise.resolve(fullPage(pageIndex, 10_000_000));
    });

    await importSolveHistoryIncremental(USER_ID, HANDLE, veryOldSyncedAt);

    expect(getUserStatusMock).toHaveBeenCalledTimes(2);
    expect(getUserStatusMock).toHaveBeenNthCalledWith(1, HANDLE, 1, 1000);
    expect(getUserStatusMock).toHaveBeenNthCalledWith(2, HANDLE, 1001, 1000);

    // The cap ended the walk, so progress is stored as a cursor instead of moving the cutoff stamp.
    expect(dbState.updateCalls).toHaveLength(1);
    expect(dbState.updateCalls[0].values).toEqual({ solveHistoryImportCursor: 2001 });
  });

  it("stamps solveHistorySyncedAt = now when the cutoff is reached (not capped)", async () => {
    const cutoffSec = 1000;
    const syncedAt = new Date(cutoffSec * 1000);
    const page = [sub(1, 2000), sub(2, 1900), sub(3, 900)]; // 900 < cutoffSec=1000 -> stop here
    getUserStatusMock.mockResolvedValueOnce(page);
    dbState.knownProblemIds = new Set(page.map((s) => `${s.problem.contestId}${s.problem.index}`));

    const before = Date.now();
    await importSolveHistoryIncremental(USER_ID, HANDLE, syncedAt);
    const after = Date.now();

    expect(dbState.updateCalls).toHaveLength(1);
    const stampedAt = dbState.updateCalls[0].values.solveHistorySyncedAt as Date;
    expect(stampedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(stampedAt.getTime()).toBeLessThanOrEqual(after);
    expect(dbState.updateCalls[0].values.solveHistoryImportCursor).toBeNull();
  });

  it("converges across repeated cap hits by resuming from the stored cursor", async () => {
    // Run 1 caps out after two pages and stores the next offset.
    const originalSyncedAt = new Date(1000 * 1000);
    getUserStatusMock.mockImplementation((_handle, from = 1) => {
      const pageIndex = Math.floor((from - 1) / 1000);
      return Promise.resolve(fullPage(pageIndex, 10_000_000));
    });

    await importSolveHistoryIncremental(USER_ID, HANDLE, originalSyncedAt);
    expect(getUserStatusMock).toHaveBeenCalledTimes(2);
    expect(getUserStatusMock).toHaveBeenNthCalledWith(1, HANDLE, 1, 1000);
    expect(getUserStatusMock).toHaveBeenNthCalledWith(2, HANDLE, 1001, 1000);
    expect(dbState.updateCalls[0].values).toEqual({ solveHistoryImportCursor: 2001 });

    // Run 2 resumes at the stored offset and reaches the original cutoff.
    getUserStatusMock.mockReset();
    getUserStatusMock.mockResolvedValueOnce([
      sub(2001, 5000),
      sub(2002, 4000),
      sub(2003, 900),
    ]);
    dbState.updateCalls = [];

    const before = Date.now();
    await importSolveHistoryIncremental(USER_ID, HANDLE, originalSyncedAt, 2001);
    const after = Date.now();

    expect(getUserStatusMock).toHaveBeenCalledTimes(1);
    expect(getUserStatusMock).toHaveBeenCalledWith(HANDLE, 2001, 1000);
    expect(dbState.updateCalls).toHaveLength(1);
    const values = dbState.updateCalls[0].values;
    expect(values.solveHistoryImportCursor).toBeNull();
    const stampedAt = values.solveHistorySyncedAt as Date;
    expect(stampedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(stampedAt.getTime()).toBeLessThanOrEqual(after);
  });

  it("falls back to the full import path when syncedAt is null", async () => {
    // A short, non-full page ends the full walk after a single fetch.
    const page = [sub(1, 5000), sub(2, 4000)];
    getUserStatusMock.mockResolvedValueOnce(page);
    dbState.knownProblemIds = new Set(page.map((s) => `${s.problem.contestId}${s.problem.index}`));

    await importSolveHistoryIncremental(USER_ID, HANDLE, null);

    // The full-import request shape: from=1, count=1000 (same page size),
    // and it still stamps solveHistorySyncedAt once done.
    expect(getUserStatusMock).toHaveBeenCalledWith(HANDLE, 1, 1000);
    expect(dbState.updateCalls).toHaveLength(1);
    expect(dbState.updateCalls[0].values.solveHistorySyncedAt).toBeInstanceOf(Date);
    expect(dbState.updateCalls[0].values.solveHistoryImportCursor).toBeNull();

    const recordedProblemIds = dbState.insertBatches
      .flat()
      .map((row) => (row as { problemId: string }).problemId);
    expect(recordedProblemIds).toContain("1000B");
    expect(recordedProblemIds).toContain("1000C");
  });
});

describe("refreshSolveHistoryIfStale", () => {
  it("no-ops when the user has no linked CF handle", async () => {
    await refreshSolveHistoryIfStale({ id: USER_ID, cfHandle: null, solveHistorySyncedAt: null });
    expect(getUserStatusMock).not.toHaveBeenCalled();
  });

  it("no-ops when the history is still fresh", async () => {
    const recentlySynced = new Date();
    await refreshSolveHistoryIfStale({
      id: USER_ID,
      cfHandle: HANDLE,
      solveHistorySyncedAt: recentlySynced,
    });
    expect(getUserStatusMock).not.toHaveBeenCalled();
  });

  it("runs the incremental import when stale", async () => {
    const staleSyncedAt = new Date(Date.now() - (SOLVE_HISTORY_STALE_SEC + 60) * 1000);
    getUserStatusMock.mockResolvedValueOnce([]); // empty page -> nothing to record, still stamps

    await refreshSolveHistoryIfStale({
      id: USER_ID,
      cfHandle: HANDLE,
      solveHistorySyncedAt: staleSyncedAt,
    });

    expect(getUserStatusMock).toHaveBeenCalledTimes(1);
    expect(dbState.updateCalls).toHaveLength(1);
  });

  it("never throws even when the underlying import rejects", async () => {
    const staleSyncedAt = new Date(Date.now() - (SOLVE_HISTORY_STALE_SEC + 60) * 1000);
    getUserStatusMock.mockRejectedValueOnce(new Error("codeforces is down"));

    await expect(
      refreshSolveHistoryIfStale({
        id: USER_ID,
        cfHandle: HANDLE,
        solveHistorySyncedAt: staleSyncedAt,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("refreshSolveHistoryForce (issue #98)", () => {
  it("fresh-solve-excluded: refreshes even when solveHistorySyncedAt is fresh, and the just-solved problem lands in user_problems", async () => {
    // A player solved a problem 10 minutes ago; their sync stamp is from just
    // before that solve, well within the staleness window (so
    // `refreshSolveHistoryIfStale` would no-op here) — but the force path
    // must still pick it up so problem selection excludes it.
    const now = new Date();
    const syncedAt = new Date(now.getTime() - 11 * 60 * 1000); // 11 min ago
    const freshSolveSec = Math.floor((now.getTime() - 10 * 60 * 1000) / 1000); // 10 min ago

    const page = [sub(1, freshSolveSec, "OK")];
    getUserStatusMock.mockResolvedValueOnce(page);
    dbState.knownProblemIds = new Set(
      page.map((s) => `${s.problem.contestId}${s.problem.index}`),
    );

    // Sanity: the staleness-gated entry point would no-op here.
    expect(isSolveHistoryStale(syncedAt, now)).toBe(false);

    await refreshSolveHistoryForce({
      id: USER_ID,
      cfHandle: HANDLE,
      solveHistorySyncedAt: syncedAt,
    });

    expect(getUserStatusMock).toHaveBeenCalledTimes(1);
    const recordedProblemIds = dbState.insertBatches
      .flat()
      .map((row) => (row as { problemId: string }).problemId);
    expect(recordedProblemIds).toContain(
      `${page[0].problem.contestId}${page[0].problem.index}`,
    );
  });

  it("still no-ops when the user has no linked CF handle", async () => {
    await refreshSolveHistoryForce({ id: USER_ID, cfHandle: null, solveHistorySyncedAt: null });
    expect(getUserStatusMock).not.toHaveBeenCalled();
  });

  it("CF down: never throws, so the ready path (and race start) is unaffected", async () => {
    const freshSyncedAt = new Date();
    getUserStatusMock.mockRejectedValueOnce(new Error("codeforces is down"));

    await expect(
      refreshSolveHistoryForce({
        id: USER_ID,
        cfHandle: HANDLE,
        solveHistorySyncedAt: freshSyncedAt,
      }),
    ).resolves.toBeUndefined();
  });
});
