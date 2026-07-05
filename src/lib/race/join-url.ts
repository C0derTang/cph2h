/**
 * Pure helper for building a challenge's shareable join URL (issue #16).
 *
 * Mirrors the `joinUrl` construction in `POST /api/races`
 * (`/challenge/{token}`, see `src/app/api/races/route.ts`) so any client that
 * only has a `challengeToken` — e.g. the pre-join {@link
 * import("@/components/race/Lobby").Lobby} showing "waiting for opponent" —
 * can reconstruct the identical link without another round-trip to the
 * server. Kept in sync with that route intentionally; if the join path ever
 * moves, update both call sites together.
 */
export function buildJoinUrl(origin: string, challengeToken: string): string {
  return new URL(`/challenge/${encodeURIComponent(challengeToken)}`, origin).toString();
}
