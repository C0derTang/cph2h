/**
 * Pure decision logic for the admin end-race control (issue #296).
 *
 * An admin may forcibly end any non-terminal race: abort it (no Elo) or, for an
 * active race, declare a winner (full Elo via `finishRace`). This module is
 * pure — `import type` only, no `@/lib/db` — so every branch is unit-testable
 * without a DB. The route (`src/app/api/admin/races/[id]/end/route.ts`) applies
 * the decision atomically: `abort` claims `WHERE status IN (pending|ready|
 * active)`, `finish` delegates to `finishRace` (the sole Elo mutex).
 */

import type { Race } from "@/lib/db/schema";

export type AdminEndRequest =
  | { action: "abort" }
  | { action: "declare_winner"; winnerId: string };

export type AdminEndDecision =
  | { kind: "abort" }
  | { kind: "finish"; outcome: "p1_win" | "p2_win"; winnerId: string }
  | {
      kind: "reject";
      reason: "already_terminal" | "not_active" | "invalid_winner";
      http: 409 | 400;
    };

/**
 * Decide how an admin end-race request resolves against a race row.
 *
 * Rules (evaluated in this order):
 * - finished/aborted → reject `already_terminal` (409) for BOTH actions.
 * - abort + pending/ready/active → `{kind:"abort"}`.
 * - declare_winner on a non-active race → reject `not_active` (409).
 * - declare_winner whose `winnerId` is neither p1Id nor the non-null p2Id →
 *   reject `invalid_winner` (400).
 * - else → `{kind:"finish", outcome, winnerId}`.
 */
export function decideAdminRaceEnd(
  race: Pick<Race, "status" | "p1Id" | "p2Id">,
  req: AdminEndRequest,
): AdminEndDecision {
  if (race.status === "finished" || race.status === "aborted") {
    return { kind: "reject", reason: "already_terminal", http: 409 };
  }

  if (req.action === "abort") {
    // pending / ready / active are all abortable (no Elo).
    return { kind: "abort" };
  }

  // declare_winner
  if (race.status !== "active") {
    return { kind: "reject", reason: "not_active", http: 409 };
  }

  if (req.winnerId === race.p1Id) {
    return { kind: "finish", outcome: "p1_win", winnerId: req.winnerId };
  }
  if (race.p2Id !== null && req.winnerId === race.p2Id) {
    return { kind: "finish", outcome: "p2_win", winnerId: req.winnerId };
  }
  return { kind: "reject", reason: "invalid_winner", http: 400 };
}
