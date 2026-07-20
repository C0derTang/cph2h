/**
 * Tournament bracket I/O (issue #240).
 *
 * Thin persistence shell over the pure logic in `bracket.ts`. Design invariants:
 * - Races stay rated and untouched — the link lives on `tournament_matches.race_id`.
 *   Races are only ever created via `createRace`; no race-engine file is modified.
 * - Resolution is pull-based: it reads finished races (the source of truth) and
 *   never registers post-finish hooks.
 * - Every multi-write mutation is a single `db.batch(...)` (neon-http has no
 *   interactive transactions); advancement is an UPDATE of a pre-existing
 *   next-round row, never an INSERT.
 * - The batch-fetch users/races via `inArray` into a `Map` follows the same
 *   shape as `src/lib/admin/registrants.ts`.
 */

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  races,
  tournamentMatches,
  tournamentRegistrations,
  users,
  type TournamentMatch,
} from "@/lib/db/schema";
import { createRace } from "@/lib/race/create";
import {
  computeRoundAdvances,
  generateBracket,
  nextSlot,
  selectSeeds,
} from "@/lib/tournament/bracket";
import type {
  CreateRoundRacesResponse,
  RaceOutcome,
  RaceStatus,
  ResolveRoundResponse,
  SeedBracketResponse,
  TournamentBracketDTO,
  TournamentMatchDTO,
  TournamentMatchPlayer,
  TournamentMatchResolution,
  TournamentMatchStatus,
} from "@/lib/types";

export type SeedBracketResult =
  | { ok: true; data: SeedBracketResponse }
  | { ok: false; error: "bracket_exists" | "no_registrants" };

export type WalkoverResult =
  | { ok: true }
  | { ok: false; error: "invalid_winner" | "match_not_pending" };

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

function toPlayer(
  userId: string | null,
  seed: number | null,
  byId: Map<string, { username: string; cfHandle: string | null; cfRating: number | null }>,
): TournamentMatchPlayer | null {
  if (!userId) return null;
  const u = byId.get(userId);
  return {
    userId,
    username: u?.username ?? "unknown",
    cfHandle: u?.cfHandle ?? null,
    cfRating: u?.cfRating ?? null,
    seed: seed ?? 0,
  };
}

/** Full bracket for the admin view, joined to user + race state. */
export async function getBracket(): Promise<TournamentBracketDTO> {
  const rows = await db
    .select()
    .from(tournamentMatches)
    .orderBy(asc(tournamentMatches.round), asc(tournamentMatches.slot));

  if (rows.length === 0) return { seeded: false, matches: [] };

  const userIds = new Set<string>();
  for (const m of rows) {
    if (m.p1Id) userIds.add(m.p1Id);
    if (m.p2Id) userIds.add(m.p2Id);
    if (m.winnerId) userIds.add(m.winnerId);
  }
  const raceIds = Array.from(
    new Set(rows.map((m) => m.raceId).filter((id): id is string => id !== null)),
  );

  const userRows = userIds.size
    ? await db.select().from(users).where(inArray(users.id, Array.from(userIds)))
    : [];
  const byId = new Map(userRows.map((u) => [u.id, u]));

  const raceRows = raceIds.length
    ? await db
        .select({ id: races.id, status: races.status, outcome: races.outcome })
        .from(races)
        .where(inArray(races.id, raceIds))
    : [];
  const raceById = new Map(raceRows.map((r) => [r.id, r]));

  const matches: TournamentMatchDTO[] = rows.map((m) => {
    const race = m.raceId ? raceById.get(m.raceId) : undefined;
    return {
      id: m.id,
      round: m.round,
      slot: m.slot,
      p1: toPlayer(m.p1Id, m.p1Seed, byId),
      p2: toPlayer(m.p2Id, m.p2Seed, byId),
      raceId: m.raceId,
      raceStatus: (race?.status ?? null) as RaceStatus | null,
      raceOutcome: (race?.outcome ?? null) as RaceOutcome | null,
      winnerId: m.winnerId,
      status: m.status as TournamentMatchStatus,
      resolution: (m.resolution ?? null) as TournamentMatchResolution | null,
      deadlineAt: m.deadlineAt ? m.deadlineAt.toISOString() : null,
    };
  });

  return { seeded: true, matches };
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

/**
 * Seed (or re-seed with `force`) the bracket from current registrations joined
 * to users. Atomic wipe+regenerate via a single `db.batch`. Returns a 409-shaped
 * `bracket_exists` when rows already exist and `!force`, or `no_registrants`
 * when nobody eligible is registered.
 */
export async function seedBracket({ force }: { force: boolean }): Promise<SeedBracketResult> {
  if (!force) {
    const existing = await db
      .select({ id: tournamentMatches.id })
      .from(tournamentMatches)
      .limit(1);
    if (existing.length > 0) return { ok: false, error: "bracket_exists" };
  }

  const regs = await db
    .select({
      userId: tournamentRegistrations.userId,
      cfRating: users.cfRating,
      registeredAt: tournamentRegistrations.createdAt,
    })
    .from(tournamentRegistrations)
    .innerJoin(users, eq(users.id, tournamentRegistrations.userId));

  if (regs.length === 0) return { ok: false, error: "no_registrants" };

  const seeded = selectSeeds(regs);
  const generated = generateBracket(seeded);

  const insertRows = generated.map((g) => ({
    round: g.round,
    slot: g.slot,
    p1Id: g.p1?.userId ?? null,
    p2Id: g.p2?.userId ?? null,
    p1Seed: g.p1?.seed ?? null,
    p2Seed: g.p2?.seed ?? null,
    raceId: null,
    winnerId: g.winner?.userId ?? null,
    status: g.status,
    resolution: g.resolution,
    deadlineAt: null,
  }));

  await db.batch([
    db.delete(tournamentMatches),
    db.insert(tournamentMatches).values(insertRows),
  ]);

  const byes = generated.filter((g) => g.resolution === "bye").length;
  return { ok: true, data: { created: insertRows.length, byes } };
}

// ---------------------------------------------------------------------------
// Create races for a round
// ---------------------------------------------------------------------------

/**
 * Create a `ready` race for every playable match in `round`: `status='pending'`,
 * both players set, and either unlinked or linked to an aborted race (recreate).
 * Per match: `createRace` (livekitRoom auto, default 40-min limit, optional
 * per-round rating filter passthrough), then a guarded UPDATE that stamps the
 * race id and a 24h informational deadline only if the link is still what we saw.
 *
 * Accepted micro-risk: a crash between the `createRace` insert and the match
 * UPDATE orphans one `ready` race — harmless, since a race never activates
 * without both players readying up.
 */
export async function createRacesForRound(
  round: number,
  filters?: { ratingMin?: number; ratingMax?: number },
): Promise<CreateRoundRacesResponse> {
  const candidates = await db
    .select()
    .from(tournamentMatches)
    .where(and(eq(tournamentMatches.round, round), eq(tournamentMatches.status, "pending")));

  const withPlayers = candidates.filter((m) => m.p1Id !== null && m.p2Id !== null);

  const linkedRaceIds = Array.from(
    new Set(withPlayers.map((m) => m.raceId).filter((id): id is string => id !== null)),
  );
  const raceRows = linkedRaceIds.length
    ? await db
        .select({ id: races.id, status: races.status })
        .from(races)
        .where(inArray(races.id, linkedRaceIds))
    : [];
  const raceStatusById = new Map(raceRows.map((r) => [r.id, r.status]));

  // Playable = no race yet, or its linked race was aborted (recreate).
  const playable = withPlayers.filter(
    (m) => m.raceId === null || raceStatusById.get(m.raceId) === "aborted",
  );

  const raceFilters =
    filters && (filters.ratingMin !== undefined || filters.ratingMax !== undefined)
      ? {
          ratingMin: filters.ratingMin ?? null,
          ratingMax: filters.ratingMax ?? null,
          dateFrom: null,
          dateTo: null,
        }
      : undefined;

  let created = 0;
  let skipped = 0;

  for (const m of playable) {
    try {
      const race = await createRace({
        p1Id: m.p1Id!,
        p2Id: m.p2Id!,
        status: "ready",
        filters: raceFilters,
      });

      const guard =
        m.raceId === null
          ? isNull(tournamentMatches.raceId)
          : eq(tournamentMatches.raceId, m.raceId);

      const updated = await db
        .update(tournamentMatches)
        .set({
          raceId: race.id,
          deadlineAt: sql`now() + interval '24 hours'`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(tournamentMatches.id, m.id), guard))
        .returning({ id: tournamentMatches.id });

      if (updated.length > 0) created++;
      else skipped++;
    } catch {
      // One match's failure must not abort the rest of the round.
      skipped++;
    }
  }

  return { created, skipped };
}

// ---------------------------------------------------------------------------
// Resolve a round
// ---------------------------------------------------------------------------

/** Seed of the winning side of a match (for the display-only next-round snapshot). */
function winnerSeed(m: TournamentMatch, winnerId: string): number | null {
  if (winnerId === m.p1Id) return m.p1Seed;
  if (winnerId === m.p2Id) return m.p2Seed;
  return null;
}

/**
 * Resolve `round`: read matches + linked races, `computeRoundAdvances`, then a
 * single `db.batch` that marks each resolved match `done` and places its winner
 * into the pre-existing next-round row. Guarded (`WHERE status='pending'`) and
 * deterministic, so re-clicking is idempotent (a second call finds nothing left
 * to advance).
 */
export async function resolveRound(round: number): Promise<ResolveRoundResponse> {
  const matches = await db
    .select()
    .from(tournamentMatches)
    .where(eq(tournamentMatches.round, round));

  const raceIds = Array.from(
    new Set(matches.map((m) => m.raceId).filter((id): id is string => id !== null)),
  );
  const raceRows = raceIds.length
    ? await db
        .select({
          id: races.id,
          status: races.status,
          outcome: races.outcome,
          winnerId: races.winnerId,
        })
        .from(races)
        .where(inArray(races.id, raceIds))
    : [];
  const raceById = new Map(raceRows.map((r) => [r.id, r]));

  const { advances, pendingRaceMatchIds, needsAttention } = computeRoundAdvances(
    matches,
    raceById,
  );

  const byId = new Map(matches.map((m) => [m.id, m]));
  const statements = [];

  for (const adv of advances) {
    const match = byId.get(adv.matchId)!;
    statements.push(
      db
        .update(tournamentMatches)
        .set({
          winnerId: adv.winnerId,
          status: "done",
          resolution: adv.resolution,
          updatedAt: sql`now()`,
        })
        .where(
          and(eq(tournamentMatches.id, adv.matchId), eq(tournamentMatches.status, "pending")),
        ),
    );

    if (adv.next) {
      const seed = winnerSeed(match, adv.winnerId);
      const set =
        adv.next.side === "p1"
          ? { p1Id: adv.winnerId, p1Seed: seed, updatedAt: sql`now()` }
          : { p2Id: adv.winnerId, p2Seed: seed, updatedAt: sql`now()` };
      statements.push(
        db
          .update(tournamentMatches)
          .set(set)
          .where(
            and(
              eq(tournamentMatches.round, adv.next.round),
              eq(tournamentMatches.slot, adv.next.slot),
            ),
          ),
      );
    }
  }

  if (statements.length > 0) {
    // db.batch requires a non-empty tuple; guard above keeps this all-or-nothing.
    await db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
  }

  return {
    resolved: advances.length,
    advanced: advances.filter((a) => a.next !== null).length,
    pendingRaces: pendingRaceMatchIds.length,
    needsAttention,
  };
}

// ---------------------------------------------------------------------------
// Walkover
// ---------------------------------------------------------------------------

/**
 * Admin walkover: force a `pending` match `done` in favor of one of its two
 * players (e.g. a no-show, or after a draw/aborted race). `db.batch` marks the
 * match done and places the winner into the next-round row.
 */
export async function applyWalkover(
  matchId: string,
  winnerId: string,
): Promise<WalkoverResult> {
  const [match] = await db
    .select()
    .from(tournamentMatches)
    .where(eq(tournamentMatches.id, matchId))
    .limit(1);

  if (!match || match.status !== "pending") {
    return { ok: false, error: "match_not_pending" };
  }
  if (!match.p1Id || !match.p2Id || (winnerId !== match.p1Id && winnerId !== match.p2Id)) {
    return { ok: false, error: "invalid_winner" };
  }

  const seed = winnerSeed(match, winnerId);
  const next = nextSlot(match.round, match.slot);

  const statements = [
    db
      .update(tournamentMatches)
      .set({
        winnerId,
        status: "done",
        resolution: "walkover",
        updatedAt: sql`now()`,
      })
      .where(and(eq(tournamentMatches.id, matchId), eq(tournamentMatches.status, "pending"))),
  ];

  if (next) {
    const set =
      next.side === "p1"
        ? { p1Id: winnerId, p1Seed: seed, updatedAt: sql`now()` }
        : { p2Id: winnerId, p2Seed: seed, updatedAt: sql`now()` };
    statements.push(
      db
        .update(tournamentMatches)
        .set(set)
        .where(
          and(eq(tournamentMatches.round, next.round), eq(tournamentMatches.slot, next.slot)),
        ),
    );
  }

  await db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
  return { ok: true };
}
