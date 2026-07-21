/**
 * GET /api/cf/oauth/callback — complete the Codeforces OIDC link flow.
 *
 * CF redirects here with `code` + `state` after the user approves. This route:
 *  1. verifies `state` against the single-use cookie (CSRF),
 *  2. exchanges `code` for tokens at the token endpoint (`client_secret_post`),
 *  3. verifies the `id_token` — HS256 signature with the CLIENT SECRET, plus
 *     `iss`/`aud`/`exp` — via `jose`, then re-checks the claims with the pure
 *     validator,
 *  4. rejects a `handle` on the community cheater blocklist (issue #184;
 *     fail-open on list unavailability — see `src/lib/cf/cheaters.ts`),
 *  5. links the `handle` claim to the caller's `users` row (rejecting a handle
 *     already owned by another user), sets the display name to match (issue
 *     #120), and imports solve history,
 *  6. redirects back to the settings page with a success or `?error=` code.
 *
 * All redirects target the fixed same-origin `${OAUTH_RESULT_PATH}` — there is
 * no open redirect. The `state` cookie is cleared on every path, making it
 * single-use.
 *
 * Cloudflare caveat: CLAUDE.md documents that CF Cloudflare-blocks server-side
 * `fetch` to `/enter` and `/submit`. The `/oauth/token` endpoint is designed
 * for server-to-server use and is expected to be exempt; the live exchange is
 * not exercisable without real credentials (see PR notes).
 */

import { NextResponse, type NextRequest } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { jwtVerify } from "jose";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getUserInfo, CfApiError } from "@/lib/cf/client";
import { getCheaterSet, isKnownCheater } from "@/lib/cf/cheaters";
import { importSolveHistory } from "@/lib/cf/history";
import { ensureUser } from "@/lib/user";
import { getOAuthConfig, getRequestOrigin } from "@/lib/cf/oauth-server";
import { enforceDbRateLimit, OAUTH_CALLBACK_POLICY } from "@/lib/ratelimit/policies";
import {
  buildTokenRequestBody,
  callbackRedirectUri,
  CF_ID_TOKEN_ALG,
  CF_ISSUER,
  CF_TOKEN_ENDPOINT,
  handleConflictsWithOtherUser,
  resultRedirectUrl,
  stateIsValid,
  STATE_COOKIE,
  STATE_COOKIE_PATH,
  validateIdTokenClaims,
  type CfIdTokenClaims,
  type OAuthErrorCode,
} from "@/lib/cf/oauth";

/** Explicit function timeout: 300 seconds. */
export const maxDuration = 300;

/** Postgres unique-violation code + the constraint on `users.cf_handle`. */
const PG_UNIQUE_VIOLATION = "23505";
const CF_HANDLE_UNIQUE_CONSTRAINT = "users_cf_handle_unique";

function isUniqueViolation(err: unknown, constraint: string): boolean {
  if (!err || typeof err !== "object") return false;
  if ((err as { code?: unknown }).code !== PG_UNIQUE_VIOLATION) return false;
  return (err as { constraint?: unknown }).constraint === constraint;
}

interface CfTokenResponse {
  id_token?: unknown;
  access_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
}

export async function GET(request: NextRequest): Promise<Response> {
  const origin = getRequestOrigin(request);

  /** Redirect to the settings page and clear the single-use state cookie. */
  function finish(error?: OAuthErrorCode): NextResponse {
    const response = NextResponse.redirect(resultRedirectUrl(origin, error));
    response.cookies.delete({ name: STATE_COOKIE, path: STATE_COOKIE_PATH });
    return response;
  }

  // Resolve auth before rate-limiting so an authenticated caller is keyed by
  // userId; an unauthenticated one (still checked here, before the 401
  // below) falls back to IP (issue #256).
  const user = await ensureUser();

  const limited = await enforceDbRateLimit(
    request,
    "oauth_callback",
    user?.id ?? null,
    OAUTH_CALLBACK_POLICY,
  );
  if (limited) return limited;

  if (!user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const config = getOAuthConfig();
  if (!config) {
    return finish("oauth_misconfigured");
  }

  const url = new URL(request.url);

  // The user denied consent, or CF reported an error on the authorize hop.
  if (url.searchParams.get("error")) {
    return finish("oauth_denied");
  }

  // 1. CSRF: state must match the single-use cookie.
  const cookieState = request.cookies.get(STATE_COOKIE)?.value;
  const stateParam = url.searchParams.get("state");
  if (!stateIsValid(cookieState, stateParam)) {
    return finish("oauth_state");
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return finish("oauth_no_code");
  }

  // 2. Exchange the code for tokens (client_secret_post). The redirect_uri
  //    must match the one sent at authorize time — recompute it identically.
  let tokenBody: CfTokenResponse;
  try {
    const tokenResponse = await fetch(CF_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: buildTokenRequestBody({
        code,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectUri: callbackRedirectUri(origin),
      }),
    });
    if (!tokenResponse.ok) {
      return finish("oauth_exchange");
    }
    tokenBody = (await tokenResponse.json()) as CfTokenResponse;
  } catch {
    return finish("oauth_exchange");
  }

  if (typeof tokenBody.id_token !== "string") {
    return finish("oauth_exchange");
  }

  // 3. Verify the id_token: HS256 signature with the CLIENT SECRET + iss/aud/exp.
  //    `jose` checks the signature and (issuer/audience) claims; the pure
  //    validator independently re-checks iss/aud/exp and extracts the handle.
  const secretKey = new TextEncoder().encode(config.clientSecret);
  let claims: CfIdTokenClaims;
  try {
    const { payload } = await jwtVerify(tokenBody.id_token, secretKey, {
      algorithms: [CF_ID_TOKEN_ALG],
      issuer: CF_ISSUER,
      audience: config.clientId,
    });
    claims = payload as CfIdTokenClaims;
  } catch {
    return finish("oauth_invalid_token");
  }

  const validation = validateIdTokenClaims(claims, {
    clientId: config.clientId,
    nowSec: Math.floor(Date.now() / 1000),
  });
  if (!validation.ok) {
    return finish(validation.error);
  }
  const { handle } = validation;

  // 4. Reject a handle on the community cheater blocklist (issue #184).
  //    Fail-open: `cheaterSet` is null when the list can't be fetched/parsed
  //    (e.g. GitHub is down), and a null set always allows — platform
  //    availability must never depend on GitHub's uptime.
  const cheaterSet = await getCheaterSet();
  if (cheaterSet && isKnownCheater(handle, cheaterSet)) {
    return finish("cheater_blocked");
  }

  // 5. Reject a handle already linked to a different account (pre-check; the
  //    unique constraint below is the actual source of truth under races).
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.cfHandle, handle), ne(users.id, user.id)));
  if (handleConflictsWithOtherUser(owner?.id ?? null, user.id)) {
    return finish("handle_taken");
  }

  // Rating: prefer the id_token claim; fall back to a best-effort user.info
  // lookup so a claim without rating still records the current value.
  let cfRating = validation.rating;
  if (cfRating === null) {
    try {
      const [info] = await getUserInfo(handle);
      if (info) cfRating = info.rating ?? null;
    } catch (err) {
      if (!(err instanceof CfApiError)) throw err;
    }
  }

  // 6. Link the handle; the display name follows the linked handle (issue #120).
  try {
    await db
      .update(users)
      .set({ cfHandle: handle, cfRating, cfLinkedAt: new Date(), username: handle })
      .where(eq(users.id, user.id));
  } catch (err) {
    if (isUniqueViolation(err, CF_HANDLE_UNIQUE_CONSTRAINT)) {
      return finish("handle_taken");
    }
    throw err;
  }

  // 7. Import solve history (best-effort; failure does not fail the link).
  //    Wrap in a 120s timeout so the import budget does not starve the overall
  //    function timeout; abort is non-fatal (already swallowed below).
  try {
    const controller = new AbortController();
    const importPromise = importSolveHistory(user.id, handle, { signal: controller.signal });

    let timeoutId: ReturnType<typeof setTimeout>;
    const timeout = new Promise<void>((resolve) => {
      timeoutId = setTimeout(() => {
        const error = new Error("oauth callback history-import budget expired");
        error.name = "AbortError";
        controller.abort(error);
        resolve();
      }, 120_000);
    });
    try {
      await Promise.race([importPromise, timeout]);
    } finally {
      clearTimeout(timeoutId!);
    }
  } catch {
    // Swallow — the account is linked; history can be re-synced later.
  }

  return finish();
}

// Per-request auth/cookies — never statically cache.
export const dynamic = "force-dynamic";
