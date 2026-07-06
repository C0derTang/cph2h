/**
 * Exhaustive tests for the pure race state machine (src/lib/race/machine.ts).
 * Covers every legal and illegal transition for each guard, plus the
 * time-dependent transition and problem-visibility gate.
 */

import { describe, it, expect } from "vitest";
import {
  canJoin,
  canReady,
  canStart,
  canAbort,
  canDecline,
  canOfferDraw,
  canAcceptDraw,
  canDeclineDraw,
  isParticipant,
  isProblemVisible,
  nextOnBothReady,
  type MachineRace,
} from "../src/lib/race/machine";
import { COUNTDOWN_SEC, type RaceStatus } from "../src/lib/types";

const P1 = "11111111-1111-1111-1111-111111111111";
const P2 = "22222222-2222-2222-2222-222222222222";
const OUTSIDER = "33333333-3333-3333-3333-333333333333";

function race(overrides: Partial<MachineRace> = {}): MachineRace {
  return {
    status: "pending",
    p1Id: P1,
    p2Id: null,
    p1Ready: false,
    p2Ready: false,
    timeLimitSec: 2400,
    drawOfferBy: null,
    challengeToken: null,
    ...overrides,
  };
}

const ALL_STATUSES: RaceStatus[] = [
  "pending",
  "ready",
  "active",
  "finished",
  "aborted",
];

describe("isParticipant", () => {
  it("recognizes p1 and p2", () => {
    const r = race({ p2Id: P2 });
    expect(isParticipant(r, P1)).toBe(true);
    expect(isParticipant(r, P2)).toBe(true);
  });
  it("rejects outsiders", () => {
    expect(isParticipant(race({ p2Id: P2 }), OUTSIDER)).toBe(false);
  });
  it("rejects when p2 unset", () => {
    expect(isParticipant(race(), P2)).toBe(false);
  });
});

describe("canJoin", () => {
  it("allows an outsider to join an open pending race", () => {
    expect(canJoin(race(), P2)).toEqual({ ok: true });
  });

  it("rejects self-join by p1", () => {
    expect(canJoin(race(), P1)).toEqual({ ok: false, reason: "self_join" });
  });

  it("rejects when an opponent already joined", () => {
    expect(canJoin(race({ p2Id: P2 }), OUTSIDER)).toEqual({
      ok: false,
      reason: "already_has_opponent",
    });
  });

  it("rejects any non-pending status", () => {
    for (const status of ALL_STATUSES.filter((s) => s !== "pending")) {
      expect(canJoin(race({ status }), P2)).toEqual({
        ok: false,
        reason: "not_pending",
      });
    }
  });

  it("checks status before opponent/self", () => {
    // ready race with p2 set: not_pending takes precedence
    expect(canJoin(race({ status: "ready", p2Id: P2 }), OUTSIDER)).toEqual({
      ok: false,
      reason: "not_pending",
    });
  });
});

describe("canReady", () => {
  it("allows p1 in ready phase", () => {
    expect(canReady(race({ status: "ready", p2Id: P2 }), P1)).toEqual({
      ok: true,
    });
  });

  it("allows p2 in ready phase", () => {
    expect(canReady(race({ status: "ready", p2Id: P2 }), P2)).toEqual({
      ok: true,
    });
  });

  it("rejects an outsider even in ready phase", () => {
    expect(canReady(race({ status: "ready", p2Id: P2 }), OUTSIDER)).toEqual({
      ok: false,
      reason: "not_participant",
    });
  });

  it("rejects any non-ready status", () => {
    for (const status of ALL_STATUSES.filter((s) => s !== "ready")) {
      expect(canReady(race({ status, p2Id: P2 }), P1)).toEqual({
        ok: false,
        reason: "not_ready_phase",
      });
    }
  });
});

describe("canStart", () => {
  it("allows when ready and both flags set", () => {
    expect(
      canStart(race({ status: "ready", p2Id: P2, p1Ready: true, p2Ready: true })),
    ).toEqual({ ok: true });
  });

  it("rejects when only p1 ready", () => {
    expect(
      canStart(race({ status: "ready", p2Id: P2, p1Ready: true })),
    ).toEqual({ ok: false, reason: "not_both_ready" });
  });

  it("rejects when only p2 ready", () => {
    expect(
      canStart(race({ status: "ready", p2Id: P2, p2Ready: true })),
    ).toEqual({ ok: false, reason: "not_both_ready" });
  });

  it("rejects when neither ready", () => {
    expect(canStart(race({ status: "ready", p2Id: P2 }))).toEqual({
      ok: false,
      reason: "not_both_ready",
    });
  });

  it("rejects any non-ready status even with both flags set", () => {
    for (const status of ALL_STATUSES.filter((s) => s !== "ready")) {
      expect(
        canStart(race({ status, p2Id: P2, p1Ready: true, p2Ready: true })),
      ).toEqual({ ok: false, reason: "not_ready_phase" });
    }
  });
});

describe("canAbort", () => {
  it("allows participants in pending/ready/active", () => {
    for (const status of ["pending", "ready", "active"] as RaceStatus[]) {
      expect(canAbort(race({ status, p2Id: P2 }), P1)).toEqual({ ok: true });
      expect(canAbort(race({ status, p2Id: P2 }), P2)).toEqual({ ok: true });
    }
  });

  it("allows p1 to abort a solo pending race", () => {
    expect(canAbort(race(), P1)).toEqual({ ok: true });
  });

  it("rejects outsiders", () => {
    expect(canAbort(race({ status: "active", p2Id: P2 }), OUTSIDER)).toEqual({
      ok: false,
      reason: "not_participant",
    });
  });

  it("rejects terminal statuses", () => {
    for (const status of ["finished", "aborted"] as RaceStatus[]) {
      expect(canAbort(race({ status, p2Id: P2 }), P1)).toEqual({
        ok: false,
        reason: "already_finished",
      });
    }
  });

  it("checks participation before terminal state", () => {
    expect(canAbort(race({ status: "finished", p2Id: P2 }), OUTSIDER)).toEqual({
      ok: false,
      reason: "not_participant",
    });
  });
});

describe("canDecline", () => {
  it("allows a pending race with a matching challenge token", () => {
    expect(
      canDecline(race({ challengeToken: "tok-abc" }), "tok-abc"),
    ).toEqual({ ok: true });
  });

  it("rejects a mismatched token", () => {
    expect(
      canDecline(race({ challengeToken: "tok-abc" }), "tok-wrong"),
    ).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("rejects when the race has no token (matchmade race)", () => {
    expect(canDecline(race({ challengeToken: null }), "tok-abc")).toEqual({
      ok: false,
      reason: "invalid_token",
    });
  });

  it("rejects any non-pending status", () => {
    for (const status of ALL_STATUSES.filter((s) => s !== "pending")) {
      expect(
        canDecline(race({ status, challengeToken: "tok-abc" }), "tok-abc"),
      ).toEqual({ ok: false, reason: "not_pending" });
    }
  });

  it("checks status before the token — not_pending wins over a wrong token", () => {
    expect(
      canDecline(
        race({ status: "ready", p2Id: P2, challengeToken: "tok-abc" }),
        "tok-wrong",
      ),
    ).toEqual({ ok: false, reason: "not_pending" });
  });
});

describe("canOfferDraw", () => {
  it("allows either participant in an active race with no offer yet", () => {
    const r = race({ status: "active", p2Id: P2 });
    expect(canOfferDraw(r, P1)).toEqual({ ok: true });
    expect(canOfferDraw(r, P2)).toEqual({ ok: true });
  });

  it("is a no-op-ok for re-offering by the same player who already offered", () => {
    const r = race({ status: "active", p2Id: P2, drawOfferBy: P1 });
    expect(canOfferDraw(r, P1)).toEqual({ ok: true });
  });

  it("still allows the opponent to offer over an outstanding offer", () => {
    const r = race({ status: "active", p2Id: P2, drawOfferBy: P1 });
    expect(canOfferDraw(r, P2)).toEqual({ ok: true });
  });

  it("rejects outsiders", () => {
    expect(
      canOfferDraw(race({ status: "active", p2Id: P2 }), OUTSIDER),
    ).toEqual({ ok: false, reason: "not_participant" });
  });

  it("rejects any non-active status", () => {
    for (const status of ALL_STATUSES.filter((s) => s !== "active")) {
      expect(canOfferDraw(race({ status, p2Id: P2 }), P1)).toEqual({
        ok: false,
        reason: "not_active",
      });
    }
  });

  it("checks participation before status", () => {
    expect(canOfferDraw(race({ status: "finished", p2Id: P2 }), OUTSIDER)).toEqual({
      ok: false,
      reason: "not_participant",
    });
  });
});

describe("canAcceptDraw", () => {
  it("allows the opponent of the offerer to accept", () => {
    const r = race({ status: "active", p2Id: P2, drawOfferBy: P1 });
    expect(canAcceptDraw(r, P2)).toEqual({ ok: true });
  });

  it("rejects the offerer accepting their own offer", () => {
    const r = race({ status: "active", p2Id: P2, drawOfferBy: P1 });
    expect(canAcceptDraw(r, P1)).toEqual({ ok: false, reason: "own_draw_offer" });
  });

  it("rejects when there is no outstanding offer", () => {
    const r = race({ status: "active", p2Id: P2, drawOfferBy: null });
    expect(canAcceptDraw(r, P1)).toEqual({ ok: false, reason: "no_draw_offer" });
    expect(canAcceptDraw(r, P2)).toEqual({ ok: false, reason: "no_draw_offer" });
  });

  it("rejects outsiders even with an outstanding offer", () => {
    const r = race({ status: "active", p2Id: P2, drawOfferBy: P1 });
    expect(canAcceptDraw(r, OUTSIDER)).toEqual({
      ok: false,
      reason: "not_participant",
    });
  });

  it("rejects any non-active status", () => {
    for (const status of ALL_STATUSES.filter((s) => s !== "active")) {
      expect(
        canAcceptDraw(race({ status, p2Id: P2, drawOfferBy: P1 }), P2),
      ).toEqual({ ok: false, reason: "not_active" });
    }
  });

  it("checks participation before status", () => {
    expect(
      canAcceptDraw(race({ status: "finished", p2Id: P2, drawOfferBy: P1 }), OUTSIDER),
    ).toEqual({ ok: false, reason: "not_participant" });
  });
});

describe("canDeclineDraw", () => {
  it("allows the opponent to decline an outstanding offer", () => {
    const r = race({ status: "active", p2Id: P2, drawOfferBy: P1 });
    expect(canDeclineDraw(r, P2)).toEqual({ ok: true });
  });

  it("allows the offerer to withdraw their own offer", () => {
    const r = race({ status: "active", p2Id: P2, drawOfferBy: P1 });
    expect(canDeclineDraw(r, P1)).toEqual({ ok: true });
  });

  it("rejects when there is no outstanding offer", () => {
    const r = race({ status: "active", p2Id: P2, drawOfferBy: null });
    expect(canDeclineDraw(r, P1)).toEqual({ ok: false, reason: "no_draw_offer" });
  });

  it("rejects outsiders", () => {
    const r = race({ status: "active", p2Id: P2, drawOfferBy: P1 });
    expect(canDeclineDraw(r, OUTSIDER)).toEqual({
      ok: false,
      reason: "not_participant",
    });
  });

  it("rejects any non-active status", () => {
    for (const status of ALL_STATUSES.filter((s) => s !== "active")) {
      expect(
        canDeclineDraw(race({ status, p2Id: P2, drawOfferBy: P1 }), P1),
      ).toEqual({ ok: false, reason: "not_active" });
    }
  });
});

describe("nextOnBothReady", () => {
  it("sets startedAt = now + COUNTDOWN_SEC and endsAt = startedAt + timeLimit", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const t = nextOnBothReady(race({ timeLimitSec: 2400 }), now);
    expect(t.status).toBe("active");
    expect(t.startedAt.getTime()).toBe(now.getTime() + COUNTDOWN_SEC * 1000);
    expect(t.endsAt.getTime()).toBe(t.startedAt.getTime() + 2400 * 1000);
  });

  it("honors a custom time limit", () => {
    const now = new Date("2026-06-01T12:00:00.000Z");
    const t = nextOnBothReady(race({ timeLimitSec: 600 }), now);
    expect(t.endsAt.getTime() - t.startedAt.getTime()).toBe(600 * 1000);
  });

  it("does not mutate the input or 'now'", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const nowCopy = new Date(now.getTime());
    const r = race();
    nextOnBothReady(r, now);
    expect(now.getTime()).toBe(nowCopy.getTime());
    expect(r.status).toBe("pending");
  });
});

describe("isProblemVisible", () => {
  it("is false before startedAt (during countdown)", () => {
    const startedAt = new Date("2026-01-01T00:00:10.000Z");
    const now = new Date("2026-01-01T00:00:05.000Z");
    expect(isProblemVisible({ startedAt }, now)).toBe(false);
  });

  it("is true exactly at startedAt", () => {
    const startedAt = new Date("2026-01-01T00:00:10.000Z");
    expect(isProblemVisible({ startedAt }, new Date(startedAt.getTime()))).toBe(
      true,
    );
  });

  it("is true after startedAt", () => {
    const startedAt = new Date("2026-01-01T00:00:10.000Z");
    const now = new Date("2026-01-01T00:05:00.000Z");
    expect(isProblemVisible({ startedAt }, now)).toBe(true);
  });

  it("is false when startedAt is null", () => {
    expect(isProblemVisible({ startedAt: null }, new Date())).toBe(false);
  });
});
