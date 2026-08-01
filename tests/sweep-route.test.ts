/**
 * Tests for src/app/api/cron/sweep/route.ts, focused on issue #308's new
 * step 3b: aborting `ready` challenge lobbies (`ready_deadline_at IS NULL`)
 * older than 24h.
 *
 * `drizzle-orm` is stubbed with tagged marker objects (real SQL condition
 * objects aren't introspectable — same convention as
 * tests/cf-rating-refresh.test.ts) so the test can assert on the exact
 * columns/values passed into `where()`, in particular that step 3b's guard
 * really does `isNull(races.readyDeadlineAt)` and never touches a matchmade
 * lobby (which always carries a deadline and belongs to step 2 instead).
 * `@/lib/db` is mocked at the `select().from().where()` /
 * `update().set().where().returning()` / `delete().where().returning()`
 * call shapes the route uses, queued per call so each of the route's
 * sequential steps gets its own canned result. `pollActiveRace`,
 * `resolveReadyTimeout`, and `refreshCfRatings` are mocked out — this test
 * exercises the sweep's own aggregation/response-shape logic, not those
 * modules (covered elsewhere).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Cond = Record<string, unknown>;

const { dbState, pollActiveRaceMock, resolveReadyTimeoutMock, refreshCfRatingsMock } =
  vi.hoisted(() => ({
    dbState: {
      selectQueue: [] as unknown[][],
      updateReturningQueue: [] as unknown[][],
      deleteReturningQueue: [] as unknown[][],
      selectCalls: [] as Cond[],
      updateCalls: [] as { table: unknown; values: unknown; where: Cond }[],
      deleteCalls: [] as { table: unknown; where: Cond }[],
    },
    pollActiveRaceMock: vi.fn(),
    resolveReadyTimeoutMock: vi.fn(),
    refreshCfRatingsMock: vi
      .fn()
      .mockResolvedValue({ checked: 0, updated: 0, failed: 0 }),
  }));

// Real drizzle SQL condition objects aren't introspectable, so stub the
// combinators with tagged marker objects the test can pattern-match on —
// same convention as tests/cf-rating-refresh.test.ts.
vi.mock("drizzle-orm", () => ({
  and: (...conds: Cond[]) => ({ __type: "and", conds }),
  or: (...conds: Cond[]) => ({ __type: "or", conds }),
  eq: (col: unknown, val: unknown) => ({ __type: "eq", col, val }),
  lt: (col: unknown, val: unknown) => ({ __type: "lt", col, val }),
  isNull: (col: unknown) => ({ __type: "isNull", col }),
  isNotNull: (col: unknown) => ({ __type: "isNotNull", col }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    __type: "sql",
    strings,
    values,
  }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (cond: Cond) => {
          dbState.selectCalls.push(cond);
          return Promise.resolve(dbState.selectQueue.shift() ?? []);
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: (cond: Cond) => {
          dbState.updateCalls.push({ table, values, where: cond });
          const promise = Promise.resolve(undefined) as Promise<undefined> & {
            returning?: () => Promise<unknown[]>;
          };
          promise.returning = () =>
            Promise.resolve(dbState.updateReturningQueue.shift() ?? []);
          return promise;
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: (cond: Cond) => {
        dbState.deleteCalls.push({ table, where: cond });
        return { returning: () => Promise.resolve(dbState.deleteReturningQueue.shift() ?? []) };
      },
    }),
  },
}));

vi.mock("@/lib/race/poll", () => ({ pollActiveRace: pollActiveRaceMock }));
vi.mock("@/lib/race/ready-timeout", () => ({
  resolveReadyTimeout: resolveReadyTimeoutMock,
}));
vi.mock("@/lib/cf/rating-refresh", () => ({ refreshCfRatings: refreshCfRatingsMock }));

import { GET } from "../src/app/api/cron/sweep/route";
import { races, queueEntries, apiRateLimits } from "../src/lib/db/schema";

const SECRET = "test-cron-secret";

function makeRequest(): Request {
  return new Request("http://localhost/api/cron/sweep", {
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

function findCond(cond: Cond, predicate: (c: Cond) => boolean): Cond | undefined {
  if (predicate(cond)) return cond;
  const conds = cond.conds as Cond[] | undefined;
  if (!conds) return undefined;
  for (const c of conds) {
    const found = findCond(c, predicate);
    if (found) return found;
  }
  return undefined;
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  dbState.selectQueue = [];
  dbState.updateReturningQueue = [];
  dbState.deleteReturningQueue = [];
  dbState.selectCalls = [];
  dbState.updateCalls = [];
  dbState.deleteCalls = [];
  pollActiveRaceMock.mockClear();
  resolveReadyTimeoutMock.mockClear().mockResolvedValue(undefined);
  refreshCfRatingsMock.mockClear().mockResolvedValue({ checked: 0, updated: 0, failed: 0 });
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("GET /api/cron/sweep — step 3b: stale ready challenge abort (issue #308)", () => {
  it("aborts stale ready challenge lobbies and reports abortedStaleReady, guarded by ready_deadline_at IS NULL", async () => {
    // Step 1 (active poll) and step 2 (matchmade ready-deadline) selects: empty,
    // so only steps 3/3b/4/6 fire.
    dbState.selectQueue = [[], []];
    // Step 3 (pending>24h abort) returns 1 row, step 3b (stale ready challenge
    // abort) returns 1 row.
    dbState.updateReturningQueue = [[{ id: "pending-race" }], [{ id: "ready-race" }]];
    // Step 4 (queue purge) and step 6 (rate-limit purge) deletes: empty.
    dbState.deleteReturningQueue = [[], []];

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.abortedPending).toBe(1);
    expect(json.abortedStaleReady).toBe(1);
    // All pre-existing keys must remain present and unchanged in shape.
    expect(json).toMatchObject({
      ok: true,
      polled: 0,
      pollFailed: 0,
      resolvedReadyTimeouts: 0,
      abortedPending: 1,
      abortedStaleReady: 1,
      purgedQueue: 0,
      ratingsChecked: 0,
      ratingsUpdated: 0,
      ratingsFailed: 0,
      purgedRateLimits: 0,
    });

    // Exactly two db.update calls: step 3 (pending abort) then step 3b (stale
    // ready-challenge abort) — no per-race lastPolledAt update fired since the
    // step-1 select was empty.
    expect(dbState.updateCalls).toHaveLength(2);

    const [pendingAbortCall, staleReadyAbortCall] = dbState.updateCalls;

    expect(pendingAbortCall.table).toBe(races);
    expect(pendingAbortCall.values).toMatchObject({ status: "aborted", outcome: "aborted" });
    // Step 3's claim must never carry the readyDeadlineAt guard.
    expect(
      findCond(pendingAbortCall.where, (c) => c.__type === "isNull" && c.col === races.readyDeadlineAt),
    ).toBeUndefined();

    expect(staleReadyAbortCall.table).toBe(races);
    expect(staleReadyAbortCall.values).toMatchObject({ status: "aborted", outcome: "aborted" });

    // The mandatory guard: status='ready' AND ready_deadline_at IS NULL.
    const statusReadyCond = findCond(
      staleReadyAbortCall.where,
      (c) => c.__type === "eq" && c.col === races.status && c.val === "ready",
    );
    expect(statusReadyCond).toBeDefined();

    const readyDeadlineIsNullCond = findCond(
      staleReadyAbortCall.where,
      (c) => c.__type === "isNull" && c.col === races.readyDeadlineAt,
    );
    expect(readyDeadlineIsNullCond).toBeDefined();

    // Must never claim on races.status = 'pending' (that's step 3's job).
    const statusPendingCond = findCond(
      staleReadyAbortCall.where,
      (c) => c.__type === "eq" && c.col === races.status && c.val === "pending",
    );
    expect(statusPendingCond).toBeUndefined();

    // The other db writes in this run stay on their expected tables.
    expect(dbState.deleteCalls.map((c) => c.table)).toEqual([queueEntries, apiRateLimits]);
  });

  it("does not touch a matchmade ready lobby (ready_deadline_at set) via step 3b", async () => {
    // Step 2's own select handles matchmade lobbies; simulate one already
    // resolved there (so it's gone from the ready+deadline-null pool by
    // construction). Step 3b's guard is what's under test — verified above
    // via the isNull(readyDeadlineAt) assertion — but this test additionally
    // pins that step 3b's returning-count reflects only what its own atomic
    // UPDATE claimed, independent of step 2's outcome.
    dbState.selectQueue = [[], [{ id: "matchmade-lobby" }]];
    dbState.updateReturningQueue = [[], []]; // step 3: none; step 3b: none
    dbState.deleteReturningQueue = [[], []];

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(resolveReadyTimeoutMock).toHaveBeenCalledTimes(1);
    expect(json.resolvedReadyTimeouts).toBe(1);
    expect(json.abortedStaleReady).toBe(0);
  });
});
