/**
 * GET /api/cf/oauth/start — begin the Codeforces OpenID Connect link flow.
 *
 * Replaces the old compile-error challenge (`/api/cf/verify/*`). Generates a
 * single-use CSRF `state`, stores it in a short-lived httpOnly `SameSite=Lax`
 * cookie scoped to the OAuth routes, and 302-redirects the browser to CF's
 * `authorization_endpoint`. The user approves on codeforces.com and CF
 * redirects back to `/api/cf/oauth/callback`.
 *
 * AUTH: a signed-in Clerk user is required (they aren't linked yet, so we use
 * `ensureUser` to resolve/provision their row rather than `requireLinkedUser`).
 */

import { NextResponse } from "next/server";
import { ensureUser } from "@/lib/user";
import { getOAuthConfig, getRequestOrigin } from "@/lib/cf/oauth-server";
import { enforceDbRateLimit, OAUTH_START_POLICY } from "@/lib/ratelimit/policies";
import {
  buildAuthorizeUrl,
  callbackRedirectUri,
  generateState,
  STATE_COOKIE,
  STATE_COOKIE_MAX_AGE_SEC,
  STATE_COOKIE_PATH,
} from "@/lib/cf/oauth";

export async function GET(request: Request): Promise<Response> {
  // Resolve auth before rate-limiting so an authenticated caller is keyed by
  // userId; an unauthenticated one (still checked here, before the 401
  // below) falls back to IP (issue #256).
  const user = await ensureUser();

  const limited = await enforceDbRateLimit(request, "oauth_start", user?.id ?? null, OAUTH_START_POLICY);
  if (limited) return limited;

  if (!user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const config = getOAuthConfig();
  if (!config) {
    // Env not configured — clear 500-level error, never a crash.
    return NextResponse.json(
      { error: "Codeforces linking is not configured on this server." },
      { status: 500 },
    );
  }

  const origin = getRequestOrigin(request);
  const state = generateState();
  const authorizeUrl = buildAuthorizeUrl({
    clientId: config.clientId,
    redirectUri: callbackRedirectUri(origin),
    state,
  });

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: STATE_COOKIE_PATH,
    maxAge: STATE_COOKIE_MAX_AGE_SEC,
  });
  return response;
}

// The route reads per-request auth/cookies — never statically cache it.
export const dynamic = "force-dynamic";
