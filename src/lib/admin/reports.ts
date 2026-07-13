/**
 * Admin reports: list, evidence, resolve (issue #175).
 *
 * Query helpers here are thin: fetch the `reports` row(s), then batch-fetch
 * the reporter/reported `users` rows the same way `buildRaceSnapshot` batches
 * player rows (`src/lib/race/snapshot.ts`) — no relational-query joins, just
 * a `Map` keyed by id. `mapReportRow` is pure (DTO mapping given rows) and is
 * unit-tested directly.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  raceSubmissions,
  races,
  reports,
  users,
  type Report,
  type User,
} from "@/lib/db/schema";
import { toPublicUser } from "@/lib/race/snapshot";
import type {
  PublicUser,
  RaceStatus,
  ReportDTO,
  ReportRaceEvidence,
  ReportReason,
  ReportStatus,
  ReportSubmissionEvidence,
} from "@/lib/types";

/** Cap on `GET /api/admin/reports` — newest first, no pagination beyond this. */
export const REPORTS_LIST_CAP = 200;

export type ReportStatusFilter = ReportStatus | "all";

/**
 * Parse the `status` query param. Unrecognized/missing values fall back to
 * `"open"` — the actionable default for the reports triage view.
 */
export function parseReportStatusFilter(value: string | null): ReportStatusFilter {
  if (value === "open" || value === "resolved" || value === "all") return value;
  return "open";
}

/** Fallback when a reporter/reported row is unexpectedly missing (deleted user). */
function placeholderUser(id: string): PublicUser {
  return {
    id,
    username: "unknown",
    cfHandle: null,
    cfRating: null,
    elo: 0,
    racesPlayed: 0,
  };
}

function resolveUser(id: string, byId: Map<string, User>): PublicUser {
  const row = byId.get(id);
  return row ? toPublicUser(row) : placeholderUser(id);
}

/** Pure DTO mapping given an already-fetched report row and its two users. */
export function mapReportRow(
  row: Report,
  reporter: PublicUser,
  reported: PublicUser,
): ReportDTO {
  return {
    id: row.id,
    raceId: row.raceId,
    reason: row.reason as ReportReason,
    note: row.note,
    status: row.status as ReportStatus,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    reporter,
    reported,
  };
}

/** Batch-fetch reporter/reported PublicUsers for a set of report rows and map to DTOs. */
async function toReportDTOs(rows: Report[]): Promise<ReportDTO[]> {
  if (rows.length === 0) return [];

  const userIds = Array.from(
    new Set(rows.flatMap((r) => [r.reporterId, r.reportedId])),
  );
  const userRows = await db.select().from(users).where(inArray(users.id, userIds));
  const byId = new Map(userRows.map((u) => [u.id, u]));

  return rows.map((row) =>
    mapReportRow(
      row,
      resolveUser(row.reporterId, byId),
      resolveUser(row.reportedId, byId),
    ),
  );
}

/** `GET /api/admin/reports` — newest first, capped at {@link REPORTS_LIST_CAP}. */
export async function listReports(status: ReportStatusFilter): Promise<ReportDTO[]> {
  const rows = await db
    .select()
    .from(reports)
    .where(status === "all" ? undefined : eq(reports.status, status))
    .orderBy(desc(reports.createdAt))
    .limit(REPORTS_LIST_CAP);

  return toReportDTOs(rows);
}

/** Fetch a single report DTO by id, or `null` if it doesn't exist. */
export async function getReportById(id: string): Promise<ReportDTO | null> {
  const [row] = await db.select().from(reports).where(eq(reports.id, id)).limit(1);
  if (!row) return null;
  const [dto] = await toReportDTOs([row]);
  return dto;
}

/**
 * `GET /api/admin/reports/[id]/evidence` — the report plus the race's
 * `race_submissions` timeline (oldest first, submit/solve order) and the
 * race row itself (issue #192, for the admin-facing duration display).
 */
export async function getReportEvidence(
  id: string,
): Promise<{
  report: ReportDTO;
  submissions: ReportSubmissionEvidence[];
  race: ReportRaceEvidence | null;
} | null> {
  const report = await getReportById(id);
  if (!report) return null;

  const submissionRows = await db
    .select()
    .from(raceSubmissions)
    .where(eq(raceSubmissions.raceId, report.raceId));

  const submissions: ReportSubmissionEvidence[] = submissionRows
    .map((s) => ({
      userId: s.userId,
      verdict: s.verdict,
      submittedAt: s.submittedAt.toISOString(),
    }))
    .sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt));

  const [raceRow] = await db
    .select()
    .from(races)
    .where(eq(races.id, report.raceId))
    .limit(1);

  const race: ReportRaceEvidence | null = raceRow
    ? {
        status: raceRow.status as RaceStatus,
        startedAt: raceRow.startedAt ? raceRow.startedAt.toISOString() : null,
        finishedAt: raceRow.finishedAt ? raceRow.finishedAt.toISOString() : null,
        timeLimitSec: raceRow.timeLimitSec,
      }
    : null;

  return { report, submissions, race };
}

/**
 * `PATCH /api/admin/reports/[id]` resolve. Atomic claim: `WHERE status='open'`
 * — a report already resolved (or a nonexistent id) returns `null`, which the
 * route maps to 409 per the issue spec (no separate 404 branch here).
 */
export async function resolveReport(id: string): Promise<ReportDTO | null> {
  const [row] = await db
    .update(reports)
    .set({ status: "resolved", resolvedAt: new Date() })
    .where(and(eq(reports.id, id), eq(reports.status, "open")))
    .returning();

  if (!row) return null;
  const [dto] = await toReportDTOs([row]);
  return dto;
}
