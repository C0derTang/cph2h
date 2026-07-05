/**
 * Codeforces authenticated-session layer.
 *
 * Ports the login flow of https://github.com/xalanq/cf-tool to TypeScript:
 * fetch the sign-in page for a CSRF token, POST the credential form, then
 * confirm the session by reading the logged-in handle back off codeforces.com.
 *
 * SECURITY: the plaintext password only ever exists as a function argument
 * here. It is never logged and never persisted — only its AES-256-GCM
 * ciphertext (produced by `@/lib/crypto`) is stored. `decryptSecret` is called
 * exclusively inside this module (`ensureSession`).
 *
 * The DB (`@/lib/db`) is imported lazily inside the persistence helpers so the
 * pure login/parse functions can be unit-tested against recorded HTML fixtures
 * without a database connection string in the environment.
 */

import { eq } from "drizzle-orm";
import { decryptSecret } from "@/lib/crypto";
import { cfCredentials, cfSessions, users } from "@/lib/db/schema";

const CF_BASE = "https://codeforces.com";
const ENTER_GET_URL = `${CF_BASE}/enter?back=%2F`;
const ENTER_POST_URL = `${CF_BASE}/enter`;
const HOME_URL = `${CF_BASE}/`;

/** Fixed browser-fingerprint value cf-tool sends as `bfaa`. */
const BFAA = "f1b3f18c715565b589b7823cda7448ce";

/** Substring Codeforces renders when credentials are rejected. */
const INVALID_CREDENTIALS_MARKER = "Invalid handle/email or password";

/**
 * How long a persisted CF session is trusted before `ensureSession`
 * re-authenticates. CF cookies live much longer, but re-logging in
 * periodically keeps the CSRF token fresh for authenticated actions.
 */
export const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type CfAuthErrorCode =
  | "invalid_credentials"
  | "login_page_unavailable"
  | "session_unconfirmed"
  | "not_linked"
  | "missing_key";

export class CfAuthError extends Error {
  readonly code: CfAuthErrorCode;
  constructor(code: CfAuthErrorCode, message: string) {
    super(message);
    this.name = "CfAuthError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Cookie jar helpers
//
// The jar is a plain `{ name: value }` map — exactly the shape stored in the
// `cf_sessions.cookie_jar` jsonb column, so no extra (de)serialization is
// needed beyond reading it back with `parseCookieJar`.
// ---------------------------------------------------------------------------

export type CookieJar = Record<string, string>;

/** Merge the `Set-Cookie` headers of a response into `jar` (mutates + returns). */
export function mergeSetCookies(jar: CookieJar, response: Response): CookieJar {
  // `getSetCookie` is available on the WHATWG Headers in Node 18+/undici and is
  // the only correct way to read multiple Set-Cookie headers.
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];
  for (const raw of setCookies) {
    const firstPair = raw.split(";", 1)[0];
    const eq = firstPair.indexOf("=");
    if (eq === -1) continue;
    const name = firstPair.slice(0, eq).trim();
    const value = firstPair.slice(eq + 1).trim();
    if (name) jar[name] = value;
  }
  return jar;
}

/** Serialize a jar into a `Cookie` request-header value. */
export function serializeCookies(jar: CookieJar): string {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

/** Coerce a jsonb value read from the DB back into a `CookieJar`. */
export function parseCookieJar(value: unknown): CookieJar {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const jar: CookieJar = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "string") jar[k] = v;
    }
    return jar;
  }
  return {};
}

// ---------------------------------------------------------------------------
// HTML parsing helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Extract the CSRF token from a Codeforces page. Prefers the hidden
 * `csrf_token` form input, falling back to the `X-Csrf-Token` meta tag.
 */
export function extractCsrfToken(html: string): string | null {
  const input =
    /name=['"]csrf_token['"][^>]*value=['"]([^'"]+)['"]/i.exec(html) ??
    /value=['"]([0-9a-f]{16,})['"][^>]*name=['"]csrf_token['"]/i.exec(html);
  if (input) return input[1];

  const meta =
    /<meta[^>]*name=['"]X-Csrf-Token['"][^>]*content=['"]([^'"]+)['"]/i.exec(html) ??
    /<meta[^>]*content=['"]([^'"]+)['"][^>]*name=['"]X-Csrf-Token['"]/i.exec(html);
  return meta ? meta[1] : null;
}

/**
 * Extract the logged-in handle from a Codeforces page. CF emits a
 * `handle = "..."` assignment in an inline script only when authenticated.
 */
export function extractLoggedInHandle(html: string): string | null {
  const match = /handle\s*=\s*"([^"]+)"/.exec(html);
  return match ? match[1] : null;
}

/** True when the page is the sign-in form rendered with a rejection notice. */
export function hasInvalidCredentialsError(html: string): boolean {
  return html.includes(INVALID_CREDENTIALS_MARKER);
}

/** Random 18-char lowercase alphanumeric value, matching cf-tool's `ftaa`. */
export function generateFtaa(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 18; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export interface CfLoginResult {
  cookieJar: CookieJar;
  /** CSRF token valid for authenticated actions on the returned session. */
  csrfToken: string;
  /** Canonical handle as reported by Codeforces after login. */
  handle: string;
}

/**
 * Log in to codeforces.com with the given credentials.
 *
 * @throws {CfAuthError} `invalid_credentials` when CF rejects the login,
 *   `login_page_unavailable` when the sign-in page cannot be parsed, and
 *   `session_unconfirmed` when the post-login handle cannot be confirmed.
 */
export async function loginToCf(handle: string, password: string): Promise<CfLoginResult> {
  const jar: CookieJar = {};

  // 1. GET the sign-in page to obtain a CSRF token + initial session cookies.
  const enterResponse = await fetch(ENTER_GET_URL, { redirect: "follow" });
  mergeSetCookies(jar, enterResponse);
  const enterHtml = await enterResponse.text();
  const csrfToken = extractCsrfToken(enterHtml);
  if (!csrfToken) {
    throw new CfAuthError(
      "login_page_unavailable",
      "Could not read the Codeforces sign-in page. Try again shortly.",
    );
  }

  // 2. POST the credential form.
  const form = new URLSearchParams({
    csrf_token: csrfToken,
    action: "enter",
    ftaa: generateFtaa(),
    bfaa: BFAA,
    handleOrEmail: handle,
    password,
    remember: "on",
  });
  const postResponse = await fetch(ENTER_POST_URL, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: serializeCookies(jar),
    },
    body: form.toString(),
  });
  mergeSetCookies(jar, postResponse);

  // On rejection CF re-renders the sign-in form (HTTP 200) with an error
  // notice; on success it 3xx-redirects with an empty body.
  const postBody = await postResponse.text().catch(() => "");
  if (hasInvalidCredentialsError(postBody)) {
    throw new CfAuthError(
      "invalid_credentials",
      "Invalid Codeforces handle/email or password.",
    );
  }

  // 3. Confirm the session by reading the logged-in handle off the home page.
  const homeResponse = await fetch(HOME_URL, {
    redirect: "follow",
    headers: { cookie: serializeCookies(jar) },
  });
  mergeSetCookies(jar, homeResponse);
  const homeHtml = await homeResponse.text();
  const loggedInHandle = extractLoggedInHandle(homeHtml);
  if (!loggedInHandle) {
    throw new CfAuthError(
      "session_unconfirmed",
      "Signed in, but the Codeforces session could not be confirmed.",
    );
  }

  return {
    cookieJar: jar,
    csrfToken: extractCsrfToken(homeHtml) ?? csrfToken,
    handle: loggedInHandle,
  };
}

// ---------------------------------------------------------------------------
// Persistence + session management (DB-backed)
// ---------------------------------------------------------------------------

/** Read and validate the AES-256-GCM key used for credential storage. */
export function getCredKey(): string {
  const key = process.env.CF_CRED_KEY;
  if (!key) {
    throw new CfAuthError(
      "missing_key",
      "CF_CRED_KEY is not configured on the server.",
    );
  }
  return key;
}

async function getDb() {
  return (await import("@/lib/db")).db;
}

/** Upsert the `cf_sessions` row for a user from a fresh login result. */
export async function persistCfSession(
  userId: string,
  result: CfLoginResult,
): Promise<void> {
  const db = await getDb();
  await db
    .insert(cfSessions)
    .values({
      userId,
      cookieJar: result.cookieJar,
      csrfToken: result.csrfToken,
      lastLoginAt: new Date(),
    })
    .onConflictDoUpdate({
      target: cfSessions.userId,
      set: {
        cookieJar: result.cookieJar,
        csrfToken: result.csrfToken,
        lastLoginAt: new Date(),
      },
    });
}

export interface CfSessionData {
  cookieJar: CookieJar;
  csrfToken: string | null;
}

/**
 * Return a usable CF session for `userId`: the persisted one when still fresh,
 * otherwise re-login using the stored (encrypted) credentials and persist the
 * refreshed session.
 *
 * @throws {CfAuthError} `not_linked` when the user has no stored handle or
 *   credentials, plus any error propagated from {@link loginToCf}.
 */
export async function ensureSession(userId: string): Promise<CfSessionData> {
  const db = await getDb();

  const [existing] = await db
    .select()
    .from(cfSessions)
    .where(eq(cfSessions.userId, userId));

  if (
    existing?.lastLoginAt &&
    Date.now() - existing.lastLoginAt.getTime() < SESSION_TTL_MS
  ) {
    return {
      cookieJar: parseCookieJar(existing.cookieJar),
      csrfToken: existing.csrfToken,
    };
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.cfHandle) {
    throw new CfAuthError("not_linked", "No linked Codeforces handle for this user.");
  }

  const [cred] = await db
    .select()
    .from(cfCredentials)
    .where(eq(cfCredentials.userId, userId));
  if (!cred) {
    throw new CfAuthError(
      "not_linked",
      "No stored Codeforces credentials for this user.",
    );
  }

  const password = decryptSecret(
    { ciphertext: cred.encryptedPassword, iv: cred.iv, authTag: cred.authTag },
    getCredKey(),
  );

  const result = await loginToCf(user.cfHandle, password);
  await persistCfSession(userId, result);

  return { cookieJar: result.cookieJar, csrfToken: result.csrfToken };
}
