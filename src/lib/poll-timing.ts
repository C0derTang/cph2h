/**
 * Pure jitter helper for client poll scheduling (issue #254).
 *
 * Root cause this smooths out: several self-rescheduling `setTimeout` poll
 * loops across the app (RaceRoom's lobby/verdict polls, Lobby's own snapshot
 * poll, the queue/presence pollers, admin panels) previously used the same
 * fixed base interval with no spread, so every open tab's next tick lands on
 * (roughly) the same wall-clock instant — a synchronized poll burst. Adding a
 * random 0–25% spread on top of the base interval — the shape RaceRoom's
 * verdict/lobby loops already used inline (`6000 + Math.floor(Math.random() *
 * 1500)`) — desynchronizes clients without changing the *average* poll
 * cadence anyone actually notices.
 *
 * `random` is injectable (defaults to `Math.random`) purely so this is
 * exhaustively unit-testable without stubbing global state.
 */
export function jitteredDelayMs(
  baseMs: number,
  random: () => number = Math.random,
): number {
  return baseMs + random() * 0.25 * baseMs;
}
