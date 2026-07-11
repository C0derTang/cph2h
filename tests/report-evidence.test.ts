import { describe, expect, it } from "vitest";
import { groupEvidenceByPlayer } from "@/lib/report-evidence";
import type { PublicUser, ReportDTO, ReportSubmissionEvidence } from "@/lib/types";

function user(id: string, username: string): PublicUser {
  return { id, username, cfHandle: null, cfRating: null, elo: 1200, racesPlayed: 5 };
}

function report(overrides: Partial<ReportDTO> = {}): ReportDTO {
  return {
    id: "report-1",
    raceId: "race-1",
    reason: "cheating",
    note: null,
    status: "open",
    createdAt: "2026-07-10T00:00:00.000Z",
    resolvedAt: null,
    reporter: user("user-a", "alice"),
    reported: user("user-b", "bob"),
    ...overrides,
  };
}

describe("groupEvidenceByPlayer", () => {
  it("groups submissions per player, sorted oldest-first", () => {
    const r = report();
    const submissions: ReportSubmissionEvidence[] = [
      { userId: "user-b", verdict: "WRONG_ANSWER", submittedAt: "2026-07-10T00:05:00.000Z" },
      { userId: "user-a", verdict: "OK", submittedAt: "2026-07-10T00:02:00.000Z" },
      { userId: "user-b", verdict: "OK", submittedAt: "2026-07-10T00:03:00.000Z" },
    ];

    const groups = groupEvidenceByPlayer(r, submissions);

    expect(groups).toHaveLength(2);
    expect(groups[0].user.id).toBe("user-a");
    expect(groups[0].submissions).toEqual([
      { userId: "user-a", verdict: "OK", submittedAt: "2026-07-10T00:02:00.000Z" },
    ]);
    expect(groups[1].user.id).toBe("user-b");
    expect(groups[1].submissions.map((s) => s.verdict)).toEqual(["OK", "WRONG_ANSWER"]);
  });

  it("returns an empty submissions list for a player with none", () => {
    const r = report();
    const groups = groupEvidenceByPlayer(r, []);
    expect(groups).toHaveLength(2);
    expect(groups[0].submissions).toEqual([]);
    expect(groups[1].submissions).toEqual([]);
  });

  it("never drops a submission from an unexpected user id", () => {
    const r = report();
    const submissions: ReportSubmissionEvidence[] = [
      { userId: "user-c", verdict: "OK", submittedAt: "2026-07-10T00:01:00.000Z" },
    ];
    const groups = groupEvidenceByPlayer(r, submissions);
    expect(groups).toHaveLength(3);
    expect(groups[2].submissions).toHaveLength(1);
  });
});
