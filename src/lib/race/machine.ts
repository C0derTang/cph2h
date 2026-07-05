/**
 * Pure race-lifecycle state machine (issue #7).
 *
 * All functions here are **pure**: they read a race snapshot (+ an explicit
 * clock where needed) and return discriminated results. No I/O, no DB, no
 * `Date.now()` — every time-dependent transition takes `now` as an argument so
 * it is exhaustively unit-testable. The DB layer (routes) is responsible for
 * applying the returned field changes atomically via
 * `UPDATE ... WHERE id=$1 AND status='<expected>' RETURNING *`.
 *
 * Statuses (`src/lib/types.ts`): pending | ready | active | finished | aborted.
 * The "countdown" phase is *derived*, not a status: a race is counting down
 * while `status === 'active' && now < startedAt`.
 */

import { COUNTDOWN_SEC } from "@/lib/types";
import type { Race } from "@/lib/db/schema";

/**
 * The subset of a race row the pure machine reads. A full {@link Race} row is
 * assignable to this, so callers pass the DB row directly; tests can build
 * minimal fixtures.
 */
export type MachineRace = Pick<
  Race,
  | "status"
  | "p1Id"
  | "p2Id"
  | "p1Ready"
  | "p2Ready"
  | "timeLimitSec"
  | "drawOfferBy"
>;

/** Reasons a guard can reject a transition. */
export type GuardReason =
  | "not_pending"
  | "already_has_opponent"
  | "self_join"
  | "not_participant"
  | "not_ready_phase"
  | "not_both_ready"
  | "already_finished"
  | "not_active"
  | "no_draw_offer"
  | "own_draw_offer";

/** Discriminated guard result. */
export type GuardResult = { ok: true } | { ok: false; reason: GuardReason };

const ok: GuardResult = { ok: true };
const fail = (reason: GuardReason): GuardResult => ({ ok: false, reason });

/** True when `userId` is one of the race's two players. */
export function isParticipant(race: MachineRace, userId: string): boolean {
  return race.p1Id === userId || race.p2Id === userId;
}

/**
 * Can `userId` join `race` as p2? Requires a pending race with no opponent yet
 * and forbids the creator joining their own challenge.
 */
export function canJoin(race: MachineRace, userId: string): GuardResult {
  if (race.status !== "pending") return fail("not_pending");
  if (race.p2Id !== null) return fail("already_has_opponent");
  if (race.p1Id === userId) return fail("self_join");
  return ok;
}

/**
 * Can `userId` toggle their ready flag? Only meaningful in the `ready` phase
 * and only for a participant.
 */
export function canReady(race: MachineRace, userId: string): GuardResult {
  if (race.status !== "ready") return fail("not_ready_phase");
  if (!isParticipant(race, userId)) return fail("not_participant");
  return ok;
}

/**
 * Can the race advance to `active`? Requires the `ready` phase with both
 * players marked ready.
 */
export function canStart(race: MachineRace): GuardResult {
  if (race.status !== "ready") return fail("not_ready_phase");
  if (!(race.p1Ready && race.p2Ready)) return fail("not_both_ready");
  return ok;
}

/**
 * Can `userId` abort `race`? Any participant may abort while the race is not
 * yet terminal (pending/ready/active).
 */
export function canAbort(race: MachineRace, userId: string): GuardResult {
  if (!isParticipant(race, userId)) return fail("not_participant");
  if (race.status === "finished" || race.status === "aborted") {
    return fail("already_finished");
  }
  return ok;
}

/**
 * Can `userId` offer (or re-offer) a draw? Any participant may offer while the
 * race is `active`. Re-offering by the same player who already has an
 * outstanding offer is a no-op-ok (idempotent) — this guard does not inspect
 * `drawOfferBy` at all.
 */
export function canOfferDraw(race: MachineRace, userId: string): GuardResult {
  if (!isParticipant(race, userId)) return fail("not_participant");
  if (race.status !== "active") return fail("not_active");
  return ok;
}

/**
 * Can `userId` accept the outstanding draw offer? Requires an active race
 * with an offer outstanding from the *opponent* — a player can never accept
 * their own offer.
 */
export function canAcceptDraw(race: MachineRace, userId: string): GuardResult {
  if (!isParticipant(race, userId)) return fail("not_participant");
  if (race.status !== "active") return fail("not_active");
  if (race.drawOfferBy === null) return fail("no_draw_offer");
  if (race.drawOfferBy === userId) return fail("own_draw_offer");
  return ok;
}

/**
 * Can `userId` decline/withdraw the outstanding draw offer? Either
 * participant may clear it: the opponent declines, or the offerer withdraws.
 */
export function canDeclineDraw(race: MachineRace, userId: string): GuardResult {
  if (!isParticipant(race, userId)) return fail("not_participant");
  if (race.status !== "active") return fail("not_active");
  if (race.drawOfferBy === null) return fail("no_draw_offer");
  return ok;
}

/** Field changes that move a both-ready race into the `active` phase. */
export interface StartTransition {
  status: "active";
  /** `now + COUNTDOWN_SEC` — the countdown runs until this instant. */
  startedAt: Date;
  /** `startedAt + timeLimitSec`. */
  endsAt: Date;
}

/**
 * Compute the field changes for the ready → active transition. Pure: the clock
 * is injected. Callers must have already checked {@link canStart}.
 *
 * `startedAt` is placed `COUNTDOWN_SEC` in the future so clients render a
 * synchronized countdown; the problem/statement stay hidden until
 * `now >= startedAt` (enforced by the snapshot builder).
 */
export function nextOnBothReady(race: MachineRace, now: Date): StartTransition {
  const startedAt = new Date(now.getTime() + COUNTDOWN_SEC * 1000);
  const endsAt = new Date(startedAt.getTime() + race.timeLimitSec * 1000);
  return { status: "active", startedAt, endsAt };
}

/**
 * True once the race has begun and the problem may be revealed: `startedAt` is
 * set and `now >= startedAt`. Used by the snapshot builder to gate the
 * problem/statement fields — they stay `null` during the pre-start countdown.
 */
export function isProblemVisible(
  race: Pick<Race, "startedAt">,
  now: Date,
): boolean {
  if (!race.startedAt) return false;
  return now.getTime() >= race.startedAt.getTime();
}
