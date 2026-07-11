/**
 * Server-only glue for the Codeforces OIDC routes (issue #173): reads the
 * OAuth env config and derives the request origin. Kept separate from the pure
 * `src/lib/cf/oauth.ts` so that module stays free of `process.env` and unit
 * testable. Not imported by any client component.
 */

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
}

/**
 * Resolve `CF_OAUTH_CLIENT_ID` / `CF_OAUTH_CLIENT_SECRET`. Returns `null` when
 * either is unset so the routes can answer with a clear 500-level error rather
 * than crashing (the app registration is manual at codeforces.com/settings/api).
 */
export function getOAuthConfig(): OAuthConfig | null {
  const clientId = process.env.CF_OAUTH_CLIENT_ID;
  const clientSecret = process.env.CF_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * Origin of the incoming request. Prefers the forwarded headers Vercel sets so
 * the derived redirect URI matches the public host (not an internal one), and
 * falls back to the request URL for local dev. Both OAuth routes use this so
 * the `redirect_uri` sent to CF at authorize time and at token-exchange time
 * are byte-identical.
 */
export function getRequestOrigin(request: Request): string {
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host}`;
  }
  return new URL(request.url).origin;
}
