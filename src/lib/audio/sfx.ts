/**
 * Shared SFX name union (issue #112) — split out from `engine.ts` so the pure
 * transition detector (`transitions.ts`) can import just the type without
 * pulling in any `AudioContext`-touching code (kept test-safe in a Node/no-DOM
 * environment).
 */
export type SfxName =
  | "race_start"
  | "verdict_ok"
  | "verdict_fail"
  | "opponent_joined"
  | "win"
  | "lose";
