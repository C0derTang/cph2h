/**
 * Matchmade ready-deadline resolution (issue #275).
 *
 * A matchmade lobby (`races.ready_deadline_at !== null`) must resolve once the
 * deadline passes. `resolveReadyTimeout` reads the pure {@link readyTimeoutAction}
 * decision and applies the matching atomic mutation:
 *
 *  - **walkover** — the single ready player wins with FULL Elo. Funnelled
 *    through {@link finishRace} (the SOLE Elo path) with a `readyWalkover`
 *    claim so `ready -> finished` is applied exactly once, pinning the exact
 *    ready flags; concurrent resolvers all lose to the one winner.
 *  - **abort** — neither player readied: an atomic `ready -> aborted` claim
 *    (re-asserting the deadline and BOTH flags still clear) applies NO Elo.
 *  - **none** — challenge race, not-yet-expired, both-ready (start in flight),
 *    or a non-`ready` status: no-op.
 *
 * Every claim is `UPDATE ... WHERE <exact predicate> RETURNING`; a lost race
 * (zero rows) is a silent no-op — another resolver (a concurrent GET, the ready
 * route, or the sweep cron) already resolved it. Callers RE-READ the row after
 * calling this so claim losers still observe the winner's terminal state.
 */

import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { races, type Race } from "@/lib/db/schema";
import { readyTimeoutAction } from "@/lib/race/machine";
import { finishRace } from "@/lib/race/finish";
import { publishRaceEvent } from "@/lib/race/hooks";

/**
 * Resolve a matchmade lobby whose ready deadline may have passed. Pure decision
 * via {@link readyTimeoutAction}; the DB mutation is the only side effect (plus
 * a best-effort event hint). Idempotent and concurrency-safe: repeated or
 * racing calls all funnel through atomic claims that exactly one caller wins.
 */
export async function resolveReadyTimeout(race: Race, now: Date): Promise<void> {
  const action = readyTimeoutAction(race, now);

  if (action.kind === "none") return;

  if (action.kind === "abort") {
    // Atomic `ready -> aborted`, re-asserting the deadline has passed and BOTH
    // ready flags are still clear, so a flag change after the caller's read
    // (someone readied at the buzzer) loses this claim. No Elo on abort.
    const [aborted] = await db
      .update(races)
      .set({ status: "aborted", outcome: "aborted", finishedAt: now })
      .where(
        and(
          eq(races.id, race.id),
          eq(races.status, "ready"),
          isNotNull(races.readyDeadlineAt),
          lt(races.readyDeadlineAt, sql`now()`),
          eq(races.p1Ready, false),
          eq(races.p2Ready, false),
        ),
      )
      .returning();

    if (!aborted) return;

    // Hint only — the snapshot is the source of truth and clients refetch it on
    // this event. There is no human aborter (the system resolved the timeout);
    // `byUserId` is a required-but-cosmetic field, so we stamp the challenger.
    await publishRaceEvent(aborted.id, { type: "aborted", byUserId: aborted.p1Id });
    return;
  }

  // Walkover: the single ready player wins with full Elo. finishRace owns the
  // atomic `ready -> finished` claim (exact-flag pinned) and all Elo — the sole
  // Elo path. Losers of the claim no-op inside finishRace.
  await finishRace({
    raceId: race.id,
    outcome: action.outcome,
    winnerId: action.winnerId,
    reason: "ready_timeout",
    readyWalkover: { readySide: action.readySide },
  });
}
