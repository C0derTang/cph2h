/**
 * Pure shaping of report evidence for the admin dashboard's expanded report
 * row (issue #176). No I/O — takes the wire response from
 * `GET /api/admin/reports/[id]/evidence` (per #175's spec: `{ report,
 * submissions }`) and groups the submission timeline per player, sorted
 * chronologically, so the component only has to render.
 */

import type { PublicUser, ReportDTO, ReportSubmissionEvidence } from "@/lib/types";

export interface PlayerEvidenceGroup {
  user: PublicUser;
  submissions: ReportSubmissionEvidence[];
}

/** Wire shape of `GET /api/admin/reports/[id]/evidence` (per #175's spec). */
export interface EvidenceResponse {
  report: ReportDTO;
  submissions: ReportSubmissionEvidence[];
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
