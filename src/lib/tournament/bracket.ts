/**
 * Tournament bracket pure logic (issue #240) — zero I/O.
 *
 * Single-elimination bracket for the Launch Tournament. A full 64-slot bracket
 * is always generated: 6 rounds, 63 matches (32 + 16 + 8 + 4 + 2 + 1). Byes for
 * unfilled seeds are resolved AND propagated at generation time so the only
 * matches left `pending` are ones that will actually be played (both sides will
 * have a competitor). Advancement in later rounds is an UPDATE of a pre-existing
 * next-round row (see `nextSlot`), never an INSERT.
 *
 * All functions here are pure and exhaustively unit-tested; the DB layer
 * (`bracket-db.ts`) is a thin persistence shell over these.
 */

import {
  TOURNAMENT_BRACKET_SIZE,
  TOURNAMENT_TOTAL_ROUNDS,
  type TournamentMatchStatus,
} from "@/lib/types";
import type { Race, TournamentMatch } from "@/lib/db/schema";

export interface SeededPlayer {
  userId: string;
  /** 1-based seed. */
  seed: number;
}

// ---------------------------------------------------------------------------
// Seed placement
// ---------------------------------------------------------------------------

/**
 * Classic single-elimination seed placement for a bracket of `size` (a power of
 * two). `result[i]` is the 1-based seed occupying slot `i`.
 *
 *   size 2 -> [1, 2]
 *   size 4 -> [1, 4, 2, 3]
 *   size 8 -> [1, 8, 4, 5, 2, 7, 3, 6]
 *
 * Round-1 match `k` pairs slots `2k` and `2k+1`; every round-1 pairing sums to
 * `size + 1` (1v64, 32v33, ...), and seeds 1 & 2 land in opposite halves so they
 * can only meet in the final.
 */
export function seedSlots(size: number): number[] {
  if (size < 1) return [];
  let seeds = [1];
  while (seeds.length < size) {
    const len = seeds.length * 2;
    const next: number[] = [];
    for (const s of seeds) {
      next.push(s);
      next.push(len + 1 - s);
    }
    seeds = next;
  }
  return seeds;
}

// ---------------------------------------------------------------------------
// Seed selection
// ---------------------------------------------------------------------------

/**
 * Pick the top `TOURNAMENT_BRACKET_SIZE` registrants and assign 1-based seeds.
 * Ordering: `cfRating` descending, a null rating sorts last; ties broken by
 * earlier `registeredAt`, then by `userId` (total order, deterministic).
 */
export function selectSeeds(
  regs: Array<{ userId: string; cfRating: number | null; registeredAt: Date }>,
): SeededPlayer[] {
  const sorted = [...regs].sort((a, b) => {
    if (a.cfRating !== b.cfRating) {
      if (a.cfRating === null) return 1;
      if (b.cfRating === null) return -1;
      return b.cfRating - a.cfRating; // higher rating first
    }
    const at = a.registeredAt.getTime();
    const bt = b.registeredAt.getTime();
    if (at !== bt) return at - bt; // earlier registration first
    if (a.userId < b.userId) return -1;
    if (a.userId > b.userId) return 1;
    return 0;
  });

  return sorted
    .slice(0, TOURNAMENT_BRACKET_SIZE)
    .map((r, i) => ({ userId: r.userId, seed: i + 1 }));
}

// ---------------------------------------------------------------------------
// Bracket generation
// ---------------------------------------------------------------------------

export interface GeneratedMatch {
  round: number;
  slot: number;
  p1: SeededPlayer | null;
  p2: SeededPlayer | null;
  /** Non-null only when the match is resolved at generation time (a bye). */
  winner: SeededPlayer | null;
  status: TournamentMatchStatus;
  resolution: "bye" | null;
}

/**
 * A subtree's generation-time outcome as it propagates upward:
 * - `empty`  — the subtree contains no real players; feeds an empty side up.
 * - `player` — a single player (won all byes so far) advances up.
 * - `tbd`    — the subtree contains a real, still-unplayed match; the winner is
 *              not yet known.
 */
type SubtreeResult =
  | { kind: "empty" }
  | { kind: "player"; player: SeededPlayer }
  | { kind: "tbd" };

/**
 * Generate all 63 matches of the full 64-slot bracket for the given seeded
 * players (`players.length` in 0..64). Byes are resolved and propagated at
 * generation time:
 * - one player vs a structurally empty side => `done`/`bye`, winner advances
 *   into the pre-existing next-round row;
 * - two empty sides => an empty match, emptiness propagates upward (double-bye
 *   cascade for N <= 32; N = 1 degenerates to an instant champion);
 * - two competitors (player and/or tbd on both sides) => a `pending` match.
 *
 * Standard top-N seeding keeps sibling subtrees balanced to within one player,
 * so a `tbd` subtree (>= 2 players) can never sit opposite a structurally empty
 * side — i.e. a real match's winner is never silently byed past a later round.
 */
export function generateBracket(players: SeededPlayer[]): GeneratedMatch[] {
  const bySeed = new Map<number, SeededPlayer>();
  for (const p of players) bySeed.set(p.seed, p);

  const slots = seedSlots(TOURNAMENT_BRACKET_SIZE);

  const matches: GeneratedMatch[] = [];
  // Per-round subtree results, indexed by slot; feeds the next round.
  let prevResults: SubtreeResult[] = [];

  for (let round = 1; round <= TOURNAMENT_TOTAL_ROUNDS; round++) {
    const count = TOURNAMENT_BRACKET_SIZE >> round; // matches this round
    const results: SubtreeResult[] = new Array(count);

    for (let slot = 0; slot < count; slot++) {
      let leftRes: SubtreeResult;
      let rightRes: SubtreeResult;

      if (round === 1) {
        const s1 = slots[2 * slot];
        const s2 = slots[2 * slot + 1];
        const p1 = bySeed.get(s1);
        const p2 = bySeed.get(s2);
        leftRes = p1 ? { kind: "player", player: p1 } : { kind: "empty" };
        rightRes = p2 ? { kind: "player", player: p2 } : { kind: "empty" };
      } else {
        leftRes = prevResults[2 * slot];
        rightRes = prevResults[2 * slot + 1];
      }

      const p1 = leftRes.kind === "player" ? leftRes.player : null;
      const p2 = rightRes.kind === "player" ? rightRes.player : null;
      const leftLive = leftRes.kind !== "empty";
      const rightLive = rightRes.kind !== "empty";

      let match: GeneratedMatch;
      let result: SubtreeResult;

      if (!leftLive && !rightLive) {
        // Both sides structurally empty: an empty match; emptiness propagates.
        match = { round, slot, p1: null, p2: null, winner: null, status: "done", resolution: null };
        result = { kind: "empty" };
      } else if (leftLive && rightLive) {
        // Both sides will have a competitor: a real, still-unplayed match.
        match = { round, slot, p1, p2, winner: null, status: "pending", resolution: null };
        result = { kind: "tbd" };
      } else {
        // Exactly one live side. Balanced seeding guarantees the live side is a
        // concrete `player` (never a `tbd`), so this is a clean bye.
        const live = leftLive ? leftRes : rightRes;
        if (live.kind === "player") {
          match = { round, slot, p1, p2, winner: live.player, status: "done", resolution: "bye" };
          result = { kind: "player", player: live.player };
        } else {
          // Unreachable for standard top-N seeding; degrade safely to pending.
          match = { round, slot, p1, p2, winner: null, status: "pending", resolution: null };
          result = { kind: "tbd" };
        }
      }

      matches.push(match);
      results[slot] = result;
    }

    prevResults = results;
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Advancement geometry
// ---------------------------------------------------------------------------

/**
 * Where the winner of match `(round, slot)` advances. Winner of `(r, s)` goes to
 * `(r+1, floor(s/2))`, into side `p1` when `s` is even and `p2` when odd.
 * Returns `null` for the final (round `TOURNAMENT_TOTAL_ROUNDS`).
 */
export function nextSlot(
  round: number,
  slot: number,
): { round: number; slot: number; side: "p1" | "p2" } | null {
  if (round >= TOURNAMENT_TOTAL_ROUNDS) return null;
  return {
    round: round + 1,
    slot: Math.floor(slot / 2),
    side: slot % 2 === 0 ? "p1" : "p2",
  };
}

// ---------------------------------------------------------------------------
// Round resolution (pull-based, from finished races)
// ---------------------------------------------------------------------------

export interface MatchAdvance {
  matchId: string;
  winnerId: string;
  resolution: "race" | "walkover";
  next: ReturnType<typeof nextSlot>;
}

/**
 * Classify a round's pending matches against their linked races (the source of
 * truth). A finished race with a winner advances; an unfinished or unlinked
 * race stays pending; a draw or an aborted race needs admin attention (walk it
 * over or recreate the race). Matches that are already `done` (byes, or
 * previously resolved) are skipped.
 */
export function computeRoundAdvances(
  matches: TournamentMatch[],
  raceById: Map<string, Pick<Race, "status" | "outcome" | "winnerId">>,
): { advances: MatchAdvance[]; pendingRaceMatchIds: string[]; needsAttention: string[] } {
  const advances: MatchAdvance[] = [];
  const pendingRaceMatchIds: string[] = [];
  const needsAttention: string[] = [];

  for (const m of matches) {
    if (m.status !== "pending") continue; // already resolved (bye/empty/done)

    const race = m.raceId ? raceById.get(m.raceId) : undefined;
    if (!race) {
      pendingRaceMatchIds.push(m.id);
      continue;
    }

    if (race.status === "finished" && race.winnerId) {
      advances.push({
        matchId: m.id,
        winnerId: race.winnerId,
        resolution: "race",
        next: nextSlot(m.round, m.slot),
      });
    } else if (race.status === "finished" || race.status === "aborted") {
      // Finished with no winner (draw) or aborted — admin must intervene.
      needsAttention.push(m.id);
    } else {
      // pending / ready / active — race not yet decided.
      pendingRaceMatchIds.push(m.id);
    }
  }

  return { advances, pendingRaceMatchIds, needsAttention };
}
