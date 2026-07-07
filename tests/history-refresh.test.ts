/**
 * Tests for the ready-time incremental solve-history refresh (issue #69):
 *  - `isSolveHistoryStale` — the pure staleness predicate.
 *  - `importSolveHistoryIncremental` — pagination cutoff over fake
 *    `user.status` pages: stops at the first submission older than
 *    `syncedAt`, respects the incremental page cap, and a null `syncedAt`
 *    falls back to the full import path.
 *  - `refreshSolveHistoryIfStale` — no-op when fresh/unlinked, never throws.
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

    // Still stamps on success even though the cap (not the cutoff) ended the walk —
    // but to the OLDEST PROCESSED submission's time, not `now` (issue #81): the
    // cap hit before the cutoff means there's an un-imported gap between this
    // stamp and the real `syncedAt`, so the next refresh must still see it as
    // unsynced and pick it back up.
    expect(dbState.updateCalls).toHaveLength(1);
    const stampedAt = dbState.updateCalls[0].values.solveHistorySyncedAt as Date;
    expect(stampedAt).toBeInstanceOf(Date);
    // Oldest processed submission is the last row of the last (2nd) full page:
    // pageIndex=1, seq=1999, creationTimeSeconds = 10_000_000 - 1999.
    expect(stampedAt.getTime()).toBe((10_000_000 - 1999) * 1000);
    // And that stamp is well before "now" — it must not be the wall-clock time.
    expect(stampedAt.getTime()).toBeLessThan(Date.now() - 1000);
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
  });

  it("self-heals: the cap-hit stamp stays stale so the next ready-up re-syncs, instead of falsely reporting complete like a `now` stamp would", async () => {
    // Note: MAX_INCREMENTAL_PAGES hard-caps every single call at 2 pages
    // (position 1-2000) regardless of the cutoff passed in — the cutoff only
    // controls how much of THAT window is treated as already-synced, not
    // which page range gets fetched. So the fix's self-healing property
    // isn't "a later call reaches deeper pages in one shot"; it's that the
    // row never gets marked artificially fresh. A stale stamp means
    // `refreshSolveHistoryIfStale` keeps re-attempting the sync on every
    // ready-up (making incremental progress and staying honest about
    // incompleteness) instead of silently reporting success and going quiet
    // for the whole staleness window while the gap sits unaddressed.

    // Run 1: cap hit before the cutoff, so it stamps to the oldest processed
    // submission's time rather than `now`.
    const originalSyncedAt = new Date(0); // never synced before, far in the past
    getUserStatusMock.mockImplementation((_handle, from = 1) => {
      const pageIndex = Math.floor((from - 1) / 1000);
      return Promise.resolve(fullPage(pageIndex, 10_000_000));
    });

    await importSolveHistoryIncremental(USER_ID, HANDLE, originalSyncedAt);
    expect(getUserStatusMock).toHaveBeenCalledTimes(2);
    const cappedStamp = dbState.updateCalls[0].values.solveHistorySyncedAt as Date;
    // Sanity: the gap between the real syncedAt and the cap-hit stamp is
    // real — there was more (older) history this run never reached.
    expect(cappedStamp.getTime()).toBeGreaterThan(originalSyncedAt.getTime());

    // The capped stamp is a real (ancient, in this fixture) submission time,
    // not `now` — so it reads as immediately stale.
    expect(isSolveHistoryStale(cappedStamp)).toBe(true);
    // Contrast: had the old bug stamped `now` instead, the row would look
    // freshly, fully synced and `refreshSolveHistoryIfStale` would skip
    // entirely for the whole staleness window — silently masking the
    // un-imported gap until it's too late (the next cutoff would already be
    // past it, per issue #81).
    expect(isSolveHistoryStale(new Date())).toBe(false);

    // Because it's stale, the very next ready-up actually re-runs the sync
    // rather than no-op'ing — proving the row isn't silently marked complete.
    getUserStatusMock.mockReset();
    getUserStatusMock.mockResolvedValueOnce([]); // nothing further to fetch this attempt
    dbState.updateCalls = [];

    await refreshSolveHistoryIfStale({
      id: USER_ID,
      cfHandle: HANDLE,
      solveHistorySyncedAt: cappedStamp,
    });

    expect(getUserStatusMock).toHaveBeenCalledTimes(1);
    expect(dbState.updateCalls).toHaveLength(1);
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
