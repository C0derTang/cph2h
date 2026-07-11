/**
 * Shared nav route classification. The "back routes" are the non-menu app
 * surfaces (leaderboard, queue, challenge, settings, race, admin) that get a
 * single on-screen Back button (top-left, SlabButton style — see RouteBack)
 * instead of the primary link bar. Kept here so both the header <Nav> and
 * <RouteBack> agree on the same set without duplicating the prefix list.
 */

export const BACK_ROUTE_PREFIXES = [
  "/leaderboard",
  "/queue",
  "/challenge",
  "/settings",
  "/race",
  "/admin",
] as const;

/** True on a back route (exact prefix match or `prefix/…` subpath) — e.g.
 *  `/challenge/new`, `/settings/cf`, `/race/[id]` all qualify. */
export function isBackRoute(pathname: string): boolean {
  return BACK_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** The menu screens (landing + dashboard) are self-contained game menus whose
 *  big slab rows already carry navigation, so the header nav collapses to
 *  minimal chrome there (issue #124). The single source of truth for both
 *  <Nav> and `isKnownRoute`. */
export const MENU_ROUTES = new Set(["/", "/dashboard"]);

/** Auth pages are Clerk catch-all routes (`/sign-in/[[...sign-in]]`,
 *  `/sign-up/[[...sign-up]]`) — prefix-matched the same way as back routes so
 *  their internal steps (e.g. `/sign-in/factor-one`) still count as known. */
const AUTH_ROUTE_PREFIXES = ["/sign-in", "/sign-up"] as const;

function isAuthRoute(pathname: string): boolean {
  return AUTH_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** True for any route the app actually serves: menu routes, back routes, and
 *  auth pages. False for everything else — i.e. what 404s. Used to collapse
 *  the header to the same minimal chrome as a menu screen on unknown paths,
 *  so a 404 never echoes the requested pathname or shows the retired link
 *  bar. Pure and dependency-free, matching the rest of this module. */
export function isKnownRoute(pathname: string): boolean {
  return (
    MENU_ROUTES.has(pathname) || isBackRoute(pathname) || isAuthRoute(pathname)
  );
}
