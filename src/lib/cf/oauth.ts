/**
 * Pure Codeforces OpenID Connect helpers (issue #173).
 *
 * Codeforces exposes an OIDC provider (announced
 * https://codeforces.com/blog/entry/145566). Its discovery document
 * (`https://codeforces.com/.well-known/openid-configuration`) pins the facts
 * this module encodes:
 *  - issuer `https://codeforces.com`
 *  - authorization_endpoint `https://codeforces.com/oauth/authorize`
 *  - token_endpoint `https://codeforces.com/oauth/token`
 *  - `response_type=code`, `scope=openid`
 *  - id_token signed with **HS256** using the CLIENT SECRET (no JWKS)
 *  - token endpoint auth `client_secret_post`
 *  - id_token claims: `sub, iss, aud, exp, iat, handle, avatar, rating`
 *
 * Everything here is pure (no I/O, no `process.env`, no DB) so it is unit
 * tested exhaustively — the HS256 *signature* check lives in the callback
 * route (it needs the secret + `jose`), but the claim validation, state
 * handling, URL building, and handle-conflict decision are all here.
 */

// ---------------------------------------------------------------------------
// Discovery-document constants
// ---------------------------------------------------------------------------

export const CF_ISSUER = "https://codeforces.com";
export const CF_AUTHORIZE_ENDPOINT = "https://codeforces.com/oauth/authorize";
export const CF_TOKEN_ENDPOINT = "https://codeforces.com/oauth/token";
export const CF_OAUTH_SCOPE = "openid";
export const CF_ID_TOKEN_ALG = "HS256";

/** Path the CF provider redirects back to; also the registered redirect URI. */
export const OAUTH_CALLBACK_PATH = "/api/cf/oauth/callback";
/** Where the link flow lands after success/failure (the old verify flow's page). */
export const OAUTH_RESULT_PATH = "/settings/cf";

/**
 * Single-use, cookie-bound CSRF `state`. httpOnly + `SameSite=Lax` (the
 * top-level redirect back from codeforces.com is a cross-site GET navigation,
 * which Lax still sends the cookie on). Scoped to the OAuth routes only.
 */
export const STATE_COOKIE = "cf_oauth_state";
export const STATE_COOKIE_PATH = "/api/cf/oauth";
/** Short window: just long enough to complete the CF authorize hop. */
export const STATE_COOKIE_MAX_AGE_SEC = 600;

/** Error codes surfaced back to `${OAUTH_RESULT_PATH}?error=<code>`. */
export type OAuthErrorCode =
  | "oauth_misconfigured"
  | "oauth_denied"
  | "oauth_state"
  | "oauth_no_code"
  | "oauth_exchange"
  | "oauth_invalid_token"
  | "handle_taken"
  | "cheater_blocked"
  | "oauth_failed";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Cryptographically-random opaque `state` value (32 bytes → 64 hex chars).
 * Uses Web Crypto `getRandomValues`, available in every Next.js runtime.
 */
export function generateState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Constant-time string comparison — avoids leaking how much of the `state`
 * matched via early-exit timing. Unequal lengths short-circuit (length is not
 * secret).
 */
export function safeStringEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Validate the callback `state` against the value stored in the single-use
 * cookie. Both must be present, non-empty, and equal. The route deletes the
 * cookie on every callback (success or failure), which is what makes `state`
 * single-use.
 */
export function stateIsValid(
  cookieState: string | null | undefined,
  queryState: string | null | undefined,
): boolean {
  if (!cookieState || !queryState) return false;
  return safeStringEquals(cookieState, queryState);
}

// ---------------------------------------------------------------------------
// URL building
// ---------------------------------------------------------------------------

/**
 * Absolute redirect URI for a given request origin. Derived from the incoming
 * request so it works identically on localhost and prod, and — critically —
 * the callback recomputes it the same way so the token exchange sends the
 * byte-identical `redirect_uri` the authorize hop used (OAuth requires them to
 * match).
 */
export function callbackRedirectUri(origin: string): string {
  return new URL(OAUTH_CALLBACK_PATH, origin).toString();
}

/** Build the `authorization_endpoint` URL for the authorize redirect. */
export function buildAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(CF_AUTHORIZE_ENDPOINT);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", CF_OAUTH_SCOPE);
  url.searchParams.set("state", params.state);
  return url.toString();
}

/**
 * `application/x-www-form-urlencoded` body for the `client_secret_post` token
 * exchange. Returns a `URLSearchParams` (the route passes it straight to
 * `fetch`, which sets the correct content-type).
 */
export function buildTokenRequestBody(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): URLSearchParams {
  return new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
  });
}

/** Same-origin result URL with an optional `?error=` code. No open redirect:
 *  the path is a fixed constant, only the origin varies (from the request). */
export function resultRedirectUrl(origin: string, error?: OAuthErrorCode): string {
  const url = new URL(OAUTH_RESULT_PATH, origin);
  if (error) url.searchParams.set("error", error);
  else url.searchParams.set("linked", "1");
  return url.toString();
}

// ---------------------------------------------------------------------------
// id_token claim validation
// ---------------------------------------------------------------------------

/** The subset of id_token claims we consume. All `unknown` until validated. */
export interface CfIdTokenClaims {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  handle?: unknown;
  rating?: unknown;
  [key: string]: unknown;
}

export type ClaimValidationResult =
  | { ok: true; handle: string; rating: number | null }
  | { ok: false; error: "oauth_invalid_token" };

/** True when `aud` equals `clientId` — the claim may be a string or an array
 *  of strings (RFC 7519 permits both). */
function audienceMatches(aud: unknown, clientId: string): boolean {
  if (typeof aud === "string") return aud === clientId;
  if (Array.isArray(aud)) return aud.some((a) => a === clientId);
  return false;
}

/**
 * Validate the decoded id_token payload's claims (given the signature is
 * already verified by `jose` in the route): `iss` must be the CF issuer, `aud`
 * must be our client id, `exp` must be in the future (with a small tolerance),
 * and `handle` must be a non-empty string. Returns the handle and (optional)
 * rating on success.
 *
 * A forged token that survives to here still fails signature verification in
 * the route; this pure check is the second, independently-tested gate on the
 * *content* of a genuinely-signed token.
 */
export function validateIdTokenClaims(
  payload: CfIdTokenClaims,
  opts: { clientId: string; nowSec: number; clockToleranceSec?: number },
): ClaimValidationResult {
  const tolerance = opts.clockToleranceSec ?? 30;

  if (payload.iss !== CF_ISSUER) return { ok: false, error: "oauth_invalid_token" };
  if (!audienceMatches(payload.aud, opts.clientId)) {
    return { ok: false, error: "oauth_invalid_token" };
  }
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
    return { ok: false, error: "oauth_invalid_token" };
  }
  if (payload.exp + tolerance <= opts.nowSec) {
    return { ok: false, error: "oauth_invalid_token" };
  }
  if (typeof payload.handle !== "string" || payload.handle.trim() === "") {
    return { ok: false, error: "oauth_invalid_token" };
  }

  const rating =
    typeof payload.rating === "number" && Number.isFinite(payload.rating)
      ? payload.rating
      : null;

  return { ok: true, handle: payload.handle, rating };
}

// ---------------------------------------------------------------------------
// Handle-conflict decision
// ---------------------------------------------------------------------------

/**
 * Whether linking `handle` would steal it from another platform user. Given
 * the id of the user row currently owning that handle (or null/undefined when
 * no row owns it), a conflict exists only when some *other* user already owns
 * it. Re-linking the same handle to the same user is fine.
 */
export function handleConflictsWithOtherUser(
  currentOwnerId: string | null | undefined,
  currentUserId: string,
): boolean {
  return currentOwnerId != null && currentOwnerId !== currentUserId;
}
