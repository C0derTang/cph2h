/**
 * Shared nav route classification. The "back routes" are the non-menu app
 * surfaces (leaderboard, queue, challenge, settings, race) that get a single
 * on-screen Back button (top-left, SlabButton style — see RouteBack) instead of
 * the primary link bar. Kept here so both the header <Nav> and <RouteBack>
 * agree on the same set without duplicating the prefix list.
 *
 * `/admin` is deliberately absent from EVERY route set in this module — the
 * admin surface is unadvertised and 404s for non-admins (the 404-not-403
 * design from issue #175), so the nav must be unable to distinguish it from a
 * nonexistent path: `/admin` gets the same minimal menu-screen chrome as any
 * unknown route, for admins and non-admins alike.
 */

export const BACK_ROUTE_PREFIXES = [
  "/leaderboard",
  "/queue",
  "/challenge",
  "/settings",
  "/race",
  "/tournament",
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

/** Fixed labels for the HUD route marker, keyed by known-prefix. Values are
 *  constants, never derived from the input pathname (issue #190) — a 404
 *  under a known prefix (e.g. `/settings/admin`) must reveal at most that the
 *  section exists, never echo what was actually typed. */
const ROUTE_MARKER_LABELS: Record<string, string> = {
  "/queue": "queue",
  "/race": "race",
  "/challenge": "challenge",
  "/settings": "settings",
  "/leaderboard": "ladder",
  "/sign-in": "auth",
  "/sign-up": "auth",
  "/tournament": "tournament",
};

/** Returns the fixed HUD marker label for the section `pathname` falls
 *  under, or `null` if it isn't one of the known back/auth prefixes (menu
 *  routes and unknown paths never show the marker). Reuses the exact/
 *  `prefix/…` matching rule shared with `isBackRoute` and `isAuthRoute` so a
 *  lookalike like `/settingsX` never false-matches. The result is always one
 *  of the fixed strings above — never a substring of `pathname`. */
export function routeMarkerLabel(pathname: string): string | null {
  for (const prefix of Object.keys(ROUTE_MARKER_LABELS)) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return ROUTE_MARKER_LABELS[prefix];
    }
  }
  return null;
}
