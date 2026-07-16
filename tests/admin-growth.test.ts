/**
 * Tests for src/lib/admin/growth.ts (issue #222): `getAdminGrowth` against a
 * mocked `@/lib/db`, following the `db.select().from().where()` thenable stub
 * pattern used in tests/admin-reports.test.ts. Verifies zero-fill, null
 * `users.createdAt` filtering, and correct day-bucket placement for both
 * series.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbState } = vi.hoisted(() => {
  const dbState = {
    selectResults: [] as unknown[][],
    selectIndex: 0,
  };
  return { dbState };
});

/** Resolves the next queued `selectResults` entry, lazily on await (Promise.all order). */
function makeSelectResult() {
  const getResult = () => dbState.selectResults[dbState.selectIndex++] ?? [];
  return {
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
  },
}));

import { getAdminGrowth } from "@/lib/admin/growth";

beforeEach(() => {
  dbState.selectResults = [];
  dbState.selectIndex = 0;
});

describe("getAdminGrowth", () => {
  const now = new Date("2026-07-10T12:00:00.000Z");

  it("zero-fills both 30-day series when there are no rows", async () => {
    dbState.selectResults = [[], []];

    const result = await getAdminGrowth(now);

    expect(result.signupsPerDay).toHaveLength(30);
    expect(result.registrationsPerDay).toHaveLength(30);
    expect(result.signupsPerDay.every((d) => d.count === 0)).toBe(true);
    expect(result.registrationsPerDay.every((d) => d.count === 0)).toBe(true);
    expect(result.signupsPerDay[29]).toEqual({ date: "2026-07-10", count: 0 });
    expect(result.signupsPerDay[0]).toEqual({ date: "2026-06-11", count: 0 });
  });

  it("filters out null users.createdAt before bucketing signups", async () => {
    dbState.selectResults = [
      [{ createdAt: new Date("2026-07-09T01:00:00.000Z") }, { createdAt: null }],
      [],
    ];

    const result = await getAdminGrowth(now);

    const day = result.signupsPerDay.find((d) => d.date === "2026-07-09");
    expect(day?.count).toBe(1);
    const total = result.signupsPerDay.reduce((sum, d) => sum + d.count, 0);
    expect(total).toBe(1);
  });

  it("buckets registrations into the correct UTC day, independent of signups", async () => {
    dbState.selectResults = [
      [],
      [
        { createdAt: new Date("2026-07-08T23:00:00.000Z") },
        { createdAt: new Date("2026-07-08T05:00:00.000Z") },
        { createdAt: new Date("2026-07-10T00:00:01.000Z") },
      ],
    ];

    const result = await getAdminGrowth(now);

    expect(result.registrationsPerDay.find((d) => d.date === "2026-07-08")?.count).toBe(2);
    expect(result.registrationsPerDay.find((d) => d.date === "2026-07-10")?.count).toBe(1);
    const total = result.registrationsPerDay.reduce((sum, d) => sum + d.count, 0);
    expect(total).toBe(3);
    expect(result.signupsPerDay.every((d) => d.count === 0)).toBe(true);
  });
});
