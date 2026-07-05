/**
 * Cross-issue coupling seams (issue #7).
 *
 * The race lifecycle backbone deliberately does NOT hard-depend on the
 * problem-pool (#6), finish/Elo (#15), or LiveKit-publish (#8/#17) work. Each
 * of those integrates through one of the hooks below. Until those issues land,
 * the defaults here are safe no-ops / stubs so this compiles, tests, and merges
 * on its own. When a downstream issue merges, it replaces the stub in place —
 * the route code that consumes these hooks stays untouched.
 */

import type { RaceEvent } from "@/lib/types";
import type { Race } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// #6 — problem selection
// ---------------------------------------------------------------------------

/**
 * Pick the problem for a race at the ready → active transition. Returns the
 * `problems.id` to assign, or `null` when no problem can be chosen yet.
 *
 * STUB: #6 (problem pool + `pickProblem` + candidate selection) is not merged.
 * Returns `null` so the transition still succeeds with `problemId = null`.
 * When #6 lands, replace this body with the real picker.
 */
export type SelectRaceProblem = (race: Race) => Promise<string | null>;

export const selectRaceProblem: SelectRaceProblem = async () => null;

// ---------------------------------------------------------------------------
// #8 / #17 — LiveKit event publishing
// ---------------------------------------------------------------------------

/**
 * Publish a race event to the room's data channel. Events are hints; clients
 * always refetch the snapshot as the source of truth (see `src/lib/types.ts`).
 *
 * NO-OP: #8 (LiveKit) is not merged. Routes call this after every transition;
 * the default swallows the event. When #8/#17 land, replace with the real
 * publisher. Kept as a mutable binding so a downstream issue can inject one.
 */
export type PublishRaceEvent = (
  raceId: string,
  event: RaceEvent,
) => Promise<void>;

export const publishRaceEvent: PublishRaceEvent = async () => {};

// ---------------------------------------------------------------------------
// #15 — finish + Elo application
// ---------------------------------------------------------------------------

/**
 * Finish a race authoritatively, applying Elo. Owned by #15.
 *
 * `null` until #15 merges. The abort route checks for `null`: when present it
 * delegates forfeit resolution (and Elo) here; when absent it falls back to a
 * local finish that sets outcome/winner/finishedAt but leaves Elo deltas
 * unset (Elo is exclusively #15's responsibility).
 */
export type FinishRace = (input: {
  raceId: string;
  outcome: "p1_win" | "p2_win" | "draw";
  winnerId: string | null;
  reason: "forfeit" | "solved" | "timeout";
}) => Promise<void>;

export const finishRace: FinishRace | null = null;
