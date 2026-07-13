/**
 * Tests for src/lib/admin/reports.ts (issue #175).
 *
 * `mapReportRow` and `parseReportStatusFilter` are pure and tested directly.
 * `listReports` / `getReportEvidence` / `resolveReport` are tested against a
 * mocked `@/lib/db`, following the `db.select().from().where()...` stub
 * pattern used in tests/race-filters-patch.test.ts. The load-bearing bit for
 * `resolveReport` is the atomic `WHERE status='open'` claim: zero rows back
 * (already resolved / nonexistent) must return `null`, never throw or apply
 * a partial update.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Report, User } from "@/lib/db/schema";

const { dbState } = vi.hoisted(() => {
  const dbState = {
    selectResults: [] as unknown[][],
    selectIndex: 0,
    updateReturns: [] as unknown[],
    updateWhereArgs: [] as unknown[],
  };
  return { dbState };
});

/**
 * Lazily resolves the next queued `selectResults` entry, and only consumes
 * that slot when the caller actually awaits/`.limit()`s/`.orderBy().limit()`s
 * — matching the different chain shapes used across reports.ts
 * (`.where().limit(1)`, `.where().orderBy().limit(n)`, plain `await .where()`).
 */
function makeSelectResult() {
  const getResult = () => dbState.selectResults[dbState.selectIndex++] ?? [];
  return {
    limit: () => Promise.resolve(getResult()),
    orderBy: () => ({ limit: () => Promise.resolve(getResult()) }),
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(getResult()).then(resolve, reject),
  };
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => makeSelectResult(),
      }),
    }),
    update: () => ({
      set: () => ({
        where: (whereArg: unknown) => {
          dbState.updateWhereArgs.push(whereArg);
          return { returning: () => Promise.resolve(dbState.updateReturns) };
        },
      }),
    }),
  },
}));

import {
  getReportEvidence,
  listReports,
  mapReportRow,
  parseReportStatusFilter,
  resolveReport,
} from "@/lib/admin/reports";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    clerkId: "clerk-1",
    username: "tourist",
    cfHandle: "tourist_cf",
    cfRating: 3500,
    cfLinkedAt: new Date(),
    elo: 2400,
    racesPlayed: 10,
    cppTemplate: "",
    solveHistorySyncedAt: null,
    solveHistoryImportCursor: null,
    createdAt: null,
    isAdmin: false,
    ...overrides,
  };
}

function makeReport(overrides: Partial<Report> = {}): Report {
  return {
    id: "report-1",
    raceId: "race-1",
    reporterId: "user-reporter",
    reportedId: "user-reported",
    reason: "cheating",
    note: "note",
    status: "open",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    resolvedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  dbState.selectResults = [];
  dbState.selectIndex = 0;
  dbState.updateReturns = [];
  dbState.updateWhereArgs = [];
});

describe("parseReportStatusFilter", () => {
  it.each([
    ["open", "open"],
    ["resolved", "resolved"],
    ["all", "all"],
  ] as const)("passes through %s", (input, expected) => {
    expect(parseReportStatusFilter(input)).toBe(expected);
  });

  it("defaults unrecognized/missing values to 'open'", () => {
    expect(parseReportStatusFilter(null)).toBe("open");
    expect(parseReportStatusFilter("bogus")).toBe("open");
  });
});

describe("mapReportRow", () => {
  it("maps a report row + users to a ReportDTO", () => {
    const row = makeReport();
    const reporter = { id: "user-reporter", username: "r", cfHandle: null, cfRating: null, elo: 1200, racesPlayed: 1 };
    const reported = { id: "user-reported", username: "d", cfHandle: null, cfRating: null, elo: 1300, racesPlayed: 2 };

    expect(mapReportRow(row, reporter, reported)).toEqual({
      id: "report-1",
      raceId: "race-1",
      reason: "cheating",
      note: "note",
      status: "open",
      createdAt: "2026-07-01T00:00:00.000Z",
      resolvedAt: null,
      reporter,
      reported,
    });
  });

  it("serializes resolvedAt when present", () => {
    const row = makeReport({ status: "resolved", resolvedAt: new Date("2026-07-02T00:00:00.000Z") });
    const u = { id: "u", username: "u", cfHandle: null, cfRating: null, elo: 1200, racesPlayed: 0 };
    expect(mapReportRow(row, u, u).resolvedAt).toBe("2026-07-02T00:00:00.000Z");
  });
});

describe("listReports", () => {
  it("returns [] without querying users when there are no reports", async () => {
    dbState.selectResults = [[]];
    const result = await listReports("open");
    expect(result).toEqual([]);
  });

  it("batch-resolves reporter/reported users and falls back to a placeholder for a missing row", async () => {
    const row = makeReport();
    const reporterRow = makeUser({ id: "user-reporter", username: "reporter" });
    // reportedId's user row is deliberately missing from the users select.
    dbState.selectResults = [[row], [reporterRow]];

    const result = await listReports("open");

    expect(result).toHaveLength(1);
    expect(result[0].reporter.username).toBe("reporter");
    expect(result[0].reported).toEqual({
      id: "user-reported",
      username: "unknown",
      cfHandle: null,
      cfRating: null,
      elo: 0,
      racesPlayed: 0,
    });
  });
});

describe("getReportEvidence", () => {
  it("returns null when the report doesn't exist", async () => {
    dbState.selectResults = [[]];
    expect(await getReportEvidence("missing")).toBeNull();
  });

  it("returns the report plus submissions ordered oldest-first, and the race row", async () => {
    const row = makeReport();
    const reporterRow = makeUser({ id: "user-reporter" });
    const reportedRow = makeUser({ id: "user-reported" });
    const submissions = [
      {
        id: "s2",
        raceId: "race-1",
        userId: "user-reported",
        cfSubmissionId: 2,
        code: "",
        verdict: "OK",
        submittedAt: new Date("2026-07-01T00:05:00.000Z"),
      },
      {
        id: "s1",
        raceId: "race-1",
        userId: "user-reporter",
        cfSubmissionId: 1,
        code: "",
        verdict: "WRONG_ANSWER",
        submittedAt: new Date("2026-07-01T00:01:00.000Z"),
      },
    ];
    const raceRow = {
      id: "race-1",
      status: "finished",
      startedAt: new Date("2026-07-01T00:00:00.000Z"),
      finishedAt: new Date("2026-07-01T00:05:32.000Z"),
      timeLimitSec: 2400,
    };
    dbState.selectResults = [[row], [reporterRow, reportedRow], submissions, [raceRow]];

    const result = await getReportEvidence("report-1");

    expect(result?.report.id).toBe("report-1");
    expect(result?.submissions).toEqual([
      { userId: "user-reporter", verdict: "WRONG_ANSWER", submittedAt: "2026-07-01T00:01:00.000Z" },
      { userId: "user-reported", verdict: "OK", submittedAt: "2026-07-01T00:05:00.000Z" },
    ]);
    expect(result?.race).toEqual({
      status: "finished",
      startedAt: "2026-07-01T00:00:00.000Z",
      finishedAt: "2026-07-01T00:05:32.000Z",
      timeLimitSec: 2400,
    });
  });

  it("returns race: null when the race row is missing", async () => {
    const row = makeReport();
    const reporterRow = makeUser({ id: "user-reporter" });
    const reportedRow = makeUser({ id: "user-reported" });
    dbState.selectResults = [[row], [reporterRow, reportedRow], [], []];

    const result = await getReportEvidence("report-1");

    expect(result?.race).toBeNull();
  });
});

describe("resolveReport", () => {
  it("returns the resolved DTO when the atomic claim wins a row", async () => {
    const resolvedRow = makeReport({ status: "resolved", resolvedAt: new Date("2026-07-03T00:00:00.000Z") });
    dbState.updateReturns = [resolvedRow];
    dbState.selectResults = [[makeUser({ id: "user-reporter" }), makeUser({ id: "user-reported" })]];

    const result = await resolveReport("report-1");

    expect(result?.status).toBe("resolved");
    expect(result?.resolvedAt).toBe("2026-07-03T00:00:00.000Z");
  });

  it("returns null when the claim loses (already resolved, or id doesn't exist) — zero rows, no partial update", async () => {
    dbState.updateReturns = [];

    const result = await resolveReport("report-1");

    expect(result).toBeNull();
  });
});
