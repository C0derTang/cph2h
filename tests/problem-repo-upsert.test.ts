/**
 * Tests for the `upsertProblems` conflict-update SQL in
 * src/lib/cf/problem-repo.ts.
 *
 * Regression guard for the contestStartedAt COALESCE: the cron/backfill
 * rebuild rows from the FULL problemset every run and stamp every row's
 * `contestStartedAt` null when `contest.list` fails (see contest-dates.ts).
 * If the onConflict update wrote `excluded.contest_started_at` directly, one
 * transient contest.list failure would wipe every previously stored date.
 * The update must instead COALESCE the incoming value with the stored one so
 * null never clobbers a known-good date.
 *
 * The DB module is mocked (no connection); we capture the onConflictDoUpdate
 * config `upsertProblems` builds and render its SQL chunks through drizzle's
 * PgDialect to assert the generated SQL.
 */

import { describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { NewProblem } from "../src/lib/db/schema";

const { onConflictCalls } = vi.hoisted(() => ({
  onConflictCalls: [] as { set: Record<string, unknown> }[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: (config: { set: Record<string, unknown> }) => {
          onConflictCalls.push(config);
          return Promise.resolve();
        },
      }),
    }),
  },
}));

import { upsertProblems } from "../src/lib/cf/problem-repo";

const dialect = new PgDialect();

function renderSetSql(chunk: unknown): string {
  return dialect.sqlToQuery(chunk as SQL).sql;
}

const row: NewProblem = {
  id: "1794C",
  contestId: 1794,
  index: "C",
  name: "Scoring Subsequences",
  rating: 1600,
  tags: ["greedy"],
  fetchedAt: new Date("2024-01-01T00:00:00Z"),
  contestStartedAt: null,
};

describe("upsertProblems conflict update", () => {
  it("COALESCEs contestStartedAt so a null incoming date never clobbers a stored one", async () => {
    onConflictCalls.length = 0;

    await upsertProblems([row]);

    expect(onConflictCalls).toHaveLength(1);
    const sql = renderSetSql(onConflictCalls[0].set.contestStartedAt);

    // Incoming (excluded) value wins when present...
    expect(sql).toMatch(/coalesce\s*\(\s*excluded\.contest_started_at\s*,/i);
    // ...and falls back to the already-stored column value when null.
    expect(sql).toContain('"problems"."contest_started_at"');
  });

  it("still overwrites the regular columns from the incoming row unconditionally", async () => {
    onConflictCalls.length = 0;

    await upsertProblems([row]);

    const set = onConflictCalls[0].set;
    expect(renderSetSql(set.rating)).toBe("excluded.rating");
    expect(renderSetSql(set.fetchedAt)).toBe("excluded.fetched_at");
    expect(renderSetSql(set.tags)).toBe("excluded.tags");
  });
});
