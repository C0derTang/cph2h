/**
 * Shared nav route classification. The "back routes" are the non-menu app
 * surfaces (leaderboard, queue, challenge, settings, race) that get a single
 * on-screen Back button (top-left, SlabButton style — see RouteBack) instead of
 * the primary link bar. Kept here so both the header <Nav> and <RouteBack>
 * agree on the same set without duplicating the prefix list.
 */

export const BACK_ROUTE_PREFIXES = [
  "/leaderboard",
  "/queue",
  "/challenge",
  "/settings",
  "/race",
] as const;

/** True on a back route (exact prefix match or `prefix/…` subpath) — e.g.
 *  `/challenge/new`, `/settings/cf`, `/race/[id]` all qualify. */
export function isBackRoute(pathname: string): boolean {
  return BACK_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
