/**
 * Authoritative race finalization + Elo application (issue #15).
 *
 * `finishRace` is the single place a race becomes `finished` and Elo is applied.
 * It is **self-guarding / idempotent**: the very first statement is an atomic
 * status claim
 *
 *   UPDATE races SET status='finished', ... WHERE id=$1 AND status='active' RETURNING *
 *
 * Only one caller can flip `active -> finished`; every other concurrent or
 * repeated call sees zero rows and returns without touching Elo. Callers
 * therefore never need their own guard (the abort route delegates here without
 * one, and the poll route / sweep cron can all race to finish the same row
 * safely).
 *
 * ## Transaction note (neon-http)
 *
 * The Drizzle `neon-http` driver does not support interactive transactions
 * (reads feeding conditional writes inside a single `BEGIN`/`COMMIT`), so we
 * split the finish in two:
 *  1. The atomic claim above — the concurrency boundary that guarantees no
 *     double application.
 *  2. Everything after it (both users' Elo, the two `elo_history` rows, and the
 *     race deltas) runs in a single `db.batch(...)`, which neon-http executes as
 *     one transactional request. That makes the Elo mutation all-or-nothing: a
 *     failure mid-way rolls the batch back rather than leaving a `finished` race
 *     with only one player's Elo applied.
 *
 * The user Elo/racesPlayed writes use atomic SQL increments (`elo = elo + $d`)
 * rather than absolute values from the earlier read, so two races that finish
 * concurrently and share a player can never lose an update.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { eloHistory, races, users } from "@/lib/db/schema";
import { applyResult } from "@/lib/elo";
import { publishRaceEvent as publishToRoom, deleteRoom } from "@/lib/livekit";
import type { RaceOutcome } from "@/lib/types";

export interface FinishRaceInput {
  raceId: string;
  /** Non-aborted terminal outcome. Elo is applied for all three. */
  outcome: "p1_win" | "p2_win" | "draw";
  winnerId: string | null;
  /** CF submission id that won the race, when the finish is a solve. */
  winningSubmissionId?: number | null;
  /** Why the race ended — informational; does not change Elo handling. */
  reason?: "forfeit" | "solved" | "timeout" | "agreement";
}

/**
 * Finalize a race exactly once and apply Elo. No-op (returns early) if the race
 * is not currently `active` — i.e. a second call, or a call that lost the claim
 * to a concurrent finisher, never double-applies Elo.
 */
export async function finishRace(input: FinishRaceInput): Promise<void> {
  const { raceId, outcome, winnerId, winningSubmissionId } = input;
  const now = new Date();

  // --- Atomic claim: active -> finished. The mutex for the whole function. ---
  const [race] = await db
    .update(races)
    .set({
      status: "finished",
      outcome,
      winnerId,
      winningSubmissionId: winningSubmissionId ?? null,
      finishedAt: now,
      // Cosmetic: an outstanding draw offer only matters while the race is
      // active, but clear it here so a finished race never shows one.
      drawOfferBy: null,
    })
    .where(and(eq(races.id, raceId), eq(races.status, "active")))
    .returning();

  if (!race) {
    // Someone else already finished this race (or it was never active).
    return;
  }

  const { p1Id, p2Id } = race;

  // Elo needs both players. An active race always has p2, but stay defensive:
  // if p2 is somehow missing, the race is still marked finished above.
  let d1 = 0;
  let d2 = 0;

  if (p2Id) {
    const playerRows = await db
      .select()
      .from(users)
      .where(inArray(users.id, [p1Id, p2Id]));
    const byId = new Map(playerRows.map((u) => [u.id, u]));
    const p1 = byId.get(p1Id);
    const p2 = byId.get(p2Id);

    if (p1 && p2) {
      const deltas = applyResult(
        { elo: p1.elo, racesPlayed: p1.racesPlayed },
        { elo: p2.elo, racesPlayed: p2.racesPlayed },
        outcome as RaceOutcome,
      );
      d1 = deltas.d1;
      d2 = deltas.d2;

      // All post-claim writes run as one neon-http batch (transactional) so the
      // Elo mutation is all-or-nothing. Elo/racesPlayed use atomic increments so
      // concurrent finishes sharing a player never clobber each other.
      await db.batch([
        db
          .update(users)
          .set({
            elo: sql`${users.elo} + ${d1}`,
            racesPlayed: sql`${users.racesPlayed} + 1`,
          })
          .where(eq(users.id, p1Id)),
        db
          .update(users)
          .set({
            elo: sql`${users.elo} + ${d2}`,
            racesPlayed: sql`${users.racesPlayed} + 1`,
          })
          .where(eq(users.id, p2Id)),
        db.insert(eloHistory).values([
          {
            userId: p1Id,
            raceId,
            eloBefore: p1.elo,
            eloAfter: p1.elo + d1,
            delta: d1,
          },
          {
            userId: p2Id,
            raceId,
            eloBefore: p2.elo,
            eloAfter: p2.elo + d2,
            delta: d2,
          },
        ]),
        db
          .update(races)
          .set({ eloDeltaP1: d1, eloDeltaP2: d2 })
          .where(eq(races.id, raceId)),
      ]);
    }
  }

  // --- After the writes: fan out the finish event, then clean up the room. ---
  const eloDeltas: Record<string, number> = { [p1Id]: d1 };
  if (p2Id) {
    eloDeltas[p2Id] = d2;
  }

  await publishToRoom(race.livekitRoom, {
    type: "race_finished",
    outcome,
    winnerId,
    eloDeltas,
  });

  // Best-effort room teardown. There is no durable timer in a serverless
  // function, so we delete inline after the finish event has been sent; the
  // event is delivered reliably before the room is removed. Errors are
  // swallowed by `deleteRoom`.
  await deleteRoom(race.livekitRoom);
}
