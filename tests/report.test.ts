/**
 * Tests for src/lib/race/report.ts (issue #174).
 */

import { describe, it, expect } from "vitest";
import {
  REPORT_NOTE_MAX_LEN,
  statusForReportGuard,
  validateReportRequest,
  type ReportableRace,
} from "../src/lib/race/report";

const P1 = "user-p1";
const P2 = "user-p2";
const OUTSIDER = "user-outsider";

function makeRace(overrides: Partial<ReportableRace> = {}): ReportableRace {
  return {
    status: "active",
    p1Id: P1,
    p2Id: P2,
    ...overrides,
  };
}

describe("validateReportRequest", () => {
  it("derives reportedId as the OTHER participant when p1 reports", () => {
    const result = validateReportRequest(makeRace(), P1, { reason: "cheating" });
    expect(result).toEqual({ ok: true, reportedId: P2 });
  });

  it("derives reportedId as the OTHER participant when p2 reports", () => {
    const result = validateReportRequest(makeRace(), P2, { reason: "cheating" });
    expect(result).toEqual({ ok: true, reportedId: P1 });
  });

  it("accepts an optional note within the length bound", () => {
    const result = validateReportRequest(makeRace(), P1, {
      reason: "abusive",
      note: "a".repeat(REPORT_NOTE_MAX_LEN),
    });
    expect(result).toEqual({ ok: true, reportedId: P2 });
  });

  it("accepts finished races too", () => {
    const result = validateReportRequest(makeRace({ status: "finished" }), P1, {
      reason: "other",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a non-participant", () => {
    const result = validateReportRequest(makeRace(), OUTSIDER, { reason: "cheating" });
    expect(result).toEqual({ ok: false, reason: "not_participant" });
  });

  it("rejects races that are not active or finished", () => {
    for (const status of ["pending", "ready", "aborted"] as const) {
      const result = validateReportRequest(makeRace({ status }), P1, {
        reason: "cheating",
      });
      expect(result).toEqual({ ok: false, reason: "invalid_status" });
    }
  });

  it("rejects a solo/pending-challenge race with no opponent", () => {
    const result = validateReportRequest(
      makeRace({ p2Id: null, status: "active" }),
      P1,
      { reason: "cheating" },
    );
    expect(result).toEqual({ ok: false, reason: "no_opponent" });
  });

  it("never derives reportedId from the caller-supplied body — only from the race row", () => {
    // Even if a malicious caller's body tried to smuggle a target id via an
    // unexpected field, the function signature only accepts reason/note —
    // there is no channel for the client to influence reportedId.
    const result = validateReportRequest(makeRace(), P1, { reason: "cheating" });
    expect(result.ok && result.reportedId).toBe(P2);
  });

  it("rejects an invalid reason", () => {
    const result = validateReportRequest(makeRace(), P1, { reason: "not_a_reason" });
    expect(result).toEqual({ ok: false, reason: "invalid_reason" });
  });

  it("rejects a note over the max length", () => {
    const result = validateReportRequest(makeRace(), P1, {
      reason: "cheating",
      note: "a".repeat(REPORT_NOTE_MAX_LEN + 1),
    });
    expect(result).toEqual({ ok: false, reason: "note_too_long" });
  });

  it("prioritizes the participant guard over reason/note validation", () => {
    const result = validateReportRequest(makeRace(), OUTSIDER, {
      reason: "garbage",
      note: "a".repeat(REPORT_NOTE_MAX_LEN + 1),
    });
    expect(result).toEqual({ ok: false, reason: "not_participant" });
  });
});

describe("statusForReportGuard", () => {
  it("maps not_participant to 403", () => {
    expect(statusForReportGuard("not_participant")).toBe(403);
  });

  it("maps every other reason to 400", () => {
    for (const reason of [
      "no_opponent",
      "invalid_status",
      "invalid_reason",
      "note_too_long",
    ] as const) {
      expect(statusForReportGuard(reason)).toBe(400);
    }
  });
});
