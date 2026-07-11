/**
 * Pure report-creation guard (issue #174).
 *
 * `POST /api/reports` lets a race participant report their opponent, in-race
 * or post-race. All decision logic — participant check, reported-id
 * derivation, reason/note validation — is pure and unit-tested here; the
 * route (`src/app/api/reports/route.ts`) stays a thin shell: auth, load the
 * race, call this, insert, map the unique-violation to 409.
 */

import { REPORT_REASONS, type ReportReason } from "@/lib/types";
import type { Race } from "@/lib/db/schema";

/** The subset of a race row this guard reads. */
export type ReportableRace = Pick<Race, "status" | "p1Id" | "p2Id">;

/** Matches the spec's "~1000 chars" bound on the optional note. */
export const REPORT_NOTE_MAX_LEN = 1000;

export type ReportGuardReason =
  | "not_participant"
  | "no_opponent"
  | "invalid_status"
  | "invalid_reason"
  | "note_too_long";

export type ReportGuardResult =
  | { ok: true; reportedId: string }
  | { ok: false; reason: ReportGuardReason };

export interface ReportRequestBody {
  reason: string;
  note?: string | null;
}

function isReportReason(value: string): value is ReportReason {
  return (REPORT_REASONS as readonly string[]).includes(value);
}

/**
 * Validate a report request against the race + caller, and derive
 * `reportedId` server-side — NEVER taken from the client, always the OTHER
 * participant of the race. Order matters: participant/status/opponent guards
 * run before body-shape validation, so a non-participant or a race with no
 * opponent never leaks whether the reason/note would otherwise be valid.
 */
export function validateReportRequest(
  race: ReportableRace,
  callerId: string,
  body: ReportRequestBody,
): ReportGuardResult {
  if (race.p1Id !== callerId && race.p2Id !== callerId) {
    return { ok: false, reason: "not_participant" };
  }
  if (race.status !== "active" && race.status !== "finished") {
    return { ok: false, reason: "invalid_status" };
  }
  const reportedId = race.p1Id === callerId ? race.p2Id : race.p1Id;
  if (!reportedId) {
    // Solo / pending-challenge races have no p2 — nobody to report.
    return { ok: false, reason: "no_opponent" };
  }
  if (!isReportReason(body.reason)) {
    return { ok: false, reason: "invalid_reason" };
  }
  if (body.note != null && body.note.length > REPORT_NOTE_MAX_LEN) {
    return { ok: false, reason: "note_too_long" };
  }
  return { ok: true, reportedId };
}

/** HTTP status for each guard failure. `not_participant` is 403 (an outsider
 *  has no business reporting on this race); everything else is a 400 (bad
 *  request against a race the caller IS part of). */
export function statusForReportGuard(reason: ReportGuardReason): number {
  return reason === "not_participant" ? 403 : 400;
}
