/**
 * Pure shaping of report evidence for the admin dashboard's expanded report
 * row (issue #176). No I/O — takes the wire response from
 * `GET /api/admin/reports/[id]/evidence` (per #175's spec: `{ report,
 * submissions }`) and groups the submission timeline per player, sorted
 * chronologically, so the component only has to render.
 */

import type {
  PublicUser,
  ReportDTO,
  ReportRaceEvidence,
  ReportSubmissionEvidence,
} from "@/lib/types";

export interface PlayerEvidenceGroup {
  user: PublicUser;
  submissions: ReportSubmissionEvidence[];
}

/**
 * Wire shape of `GET /api/admin/reports/[id]/evidence` (per #175's spec,
 * extended with `race` in #192). `race` is optional so older cached
 * responses (pre-#192) still type-check when read.
 */
export interface EvidenceResponse {
  report: ReportDTO;
  submissions: ReportSubmissionEvidence[];
  race?: ReportRaceEvidence | null;
}

/**
 * Group a report's submission timeline by player (reporter, then reported —
 * a stable, meaningful order rather than whichever userId sorts first),
 * each list sorted oldest-first. Players with no submissions still get an
 * empty group so the UI can render an explicit "no submissions" state.
 */
export function groupEvidenceByPlayer(
  report: ReportDTO,
  submissions: ReportSubmissionEvidence[],
): PlayerEvidenceGroup[] {
  const byUser = new Map<string, ReportSubmissionEvidence[]>();
  for (const submission of submissions) {
    const existing = byUser.get(submission.userId);
    if (existing) {
      existing.push(submission);
    } else {
      byUser.set(submission.userId, [submission]);
    }
  }

  const sortByTime = (list: ReportSubmissionEvidence[]) =>
    [...list].sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt));

  const players = [report.reporter, report.reported];
  const groups = players.map((user) => ({
    user,
    submissions: sortByTime(byUser.get(user.id) ?? []),
  }));

  // Surface any submission from a third party (shouldn't happen, but the
  // timeline should never silently drop data) after the two known players.
  const knownIds = new Set(players.map((p) => p.id));
  for (const [userId, list] of byUser) {
    if (!knownIds.has(userId)) {
      groups.push({
        user: { id: userId, username: userId, cfHandle: null, cfRating: null, elo: 0, racesPlayed: 0 },
        submissions: sortByTime(list),
      });
    }
  }

  return groups;
}

/** What {@link deriveRaceDuration} renders for the "Duration" line. */
export interface RaceDurationDisplay {
  label: string;
}

/** Title-cases a `RaceStatus` value for display (e.g. "active" -> "Active"). */
function formatRaceStatusLabel(status: ReportRaceEvidence["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** Elapsed time as `M:SS`, with an `H:` prefix only once the race ran >= 1h. */
function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours >= 1
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

/**
 * Pure derivation of the admin "Duration" line (issue #192) from the race
 * evidence row. The component renders `.label` directly and omits the line
 * entirely when this returns `null`.
 *
 * - Both `startedAt`/`finishedAt` set: elapsed `M:SS` (or `H:MM:SS` past an
 *   hour) plus the race status (e.g. "5:32 · Finished").
 * - Started but not finished (active, or aborted without a finish stamp):
 *   just the race status (e.g. "Active").
 * - Never started (`startedAt` null): "Never started".
 * - `race` missing/undefined: `null` (the caller omits the line).
 */
export function deriveRaceDuration(
  race: ReportRaceEvidence | null | undefined,
): RaceDurationDisplay | null {
  if (!race) return null;
  if (!race.startedAt) return { label: "Never started" };
  if (!race.finishedAt) return { label: formatRaceStatusLabel(race.status) };

  const elapsedMs = Date.parse(race.finishedAt) - Date.parse(race.startedAt);
  return { label: `${formatElapsed(elapsedMs)} · ${formatRaceStatusLabel(race.status)}` };
}
