/**
 * Route-facing rate-limit policies for every enforced route (issues #256 +
 * #257).
 *
 * Two policy families share this one module so there is a single source of
 * truth for every route's limit:
 *
 *  - **Sensitive routes (#256)**: persistent "db"-backed policies
 *    (`RACES_CREATE_POLICY` etc.) enforced via {@link enforceDbRateLimit}.
 *    Importing this module (directly or transitively) is what registers the
 *    db backend: the `import "./db"` below runs `./db.ts`'s module-scope
 *    `registerDbBackend(checkDb)` as a side effect. Every #256 route imports
 *    {@link enforceDbRateLimit} from this file rather than reaching for
 *    `enforceRateLimit`/`backend: "db"` directly, so registration always
 *    happens before the check runs — no route needs to remember a second
 *    import for wiring.
 *  - **Hot/polling routes (#257)**: in-memory "memory"-backed policies
 *    (`RATE_LIMIT_POLICIES`) enforced via {@link enforcePolicy} /
 *    {@link enforceAdminPolicy}. All windows are one minute; see issue #257
 *    for the legit-client-rate rationale (each limit is a 2-4x-headroom
 *    multiple of an authentic client's call rate).
 *
 * Keeps routes thin per CLAUDE.md: a route just calls the relevant
 * one-liner and returns the result if non-null. No policy numbers or
 * backend selection live in route files.
 */

import "./db";
import { NextResponse } from "next/server";
import { enforceRateLimit, rateLimitKey, type RateLimitPolicy } from "./index";

const ONE_MINUTE_MS = 60_000;

// ---------------------------------------------------------------------------
// #256 — sensitive routes, db-backed
// ---------------------------------------------------------------------------

/** `POST /api/races` — 10/min. */
export const RACES_CREATE_POLICY: RateLimitPolicy = { limit: 10, windowMs: ONE_MINUTE_MS };
/** `POST /api/races/join` — 15/min. */
export const RACES_JOIN_POLICY: RateLimitPolicy = { limit: 15, windowMs: ONE_MINUTE_MS };
/** `POST /api/reports` — 5/min. */
export const REPORTS_CREATE_POLICY: RateLimitPolicy = { limit: 5, windowMs: ONE_MINUTE_MS };
/** `POST /api/tournament/register` — 3/min. */
export const TOURNAMENT_REGISTER_POLICY: RateLimitPolicy = { limit: 3, windowMs: ONE_MINUTE_MS };
/** `GET /api/cf/oauth/start` — 5/min. */
export const OAUTH_START_POLICY: RateLimitPolicy = { limit: 5, windowMs: ONE_MINUTE_MS };
/** `GET /api/cf/oauth/callback` — 3/min. */
export const OAUTH_CALLBACK_POLICY: RateLimitPolicy = { limit: 3, windowMs: ONE_MINUTE_MS };

/**
 * Enforce `policy` for `name` against the persistent db backend, keyed by
 * `userId` when the caller is signed in, else derived from the request's IP
 * headers (see `rateLimitKey`). Returns a ready 429 response to return
 * as-is, or `null` when the request may proceed.
 */
export async function enforceDbRateLimit(
  req: Request,
  name: string,
  userId: string | null,
  policy: RateLimitPolicy,
): Promise<Response | null> {
  const key = rateLimitKey(name, userId, req);
  return enforceRateLimit(req, key, { name, policy, backend: "db" });
}

// ---------------------------------------------------------------------------
// #257 — hot/polling routes, memory-backed
// ---------------------------------------------------------------------------

const perMinute = (limit: number): RateLimitPolicy => ({ limit, windowMs: ONE_MINUTE_MS });

export const RATE_LIMIT_POLICIES = {
  /** POST /api/races/[id]/poll */
  racePoll: { name: "race-poll", policy: perMinute(40) },
  /** GET /api/races/[id] */
  raceSnapshot: { name: "race-snapshot", policy: perMinute(60) },
  /** GET /api/queue */
  queueGet: { name: "queue-get", policy: perMinute(60) },
  /** POST /api/queue, DELETE /api/queue */
  queueWrite: { name: "queue-write", policy: perMinute(15) },
  /** GET /api/presence */
  presence: { name: "presence", policy: perMinute(30) },
  /** GET /api/leaderboard (public, per-IP) */
  leaderboard: { name: "leaderboard", policy: perMinute(30) },
  /** POST /api/races/[id]/ready */
  raceReady: { name: "race-ready", policy: perMinute(20) },
  /** POST /api/races/[id]/abort */
  raceAbort: { name: "race-abort", policy: perMinute(20) },
  /** POST /api/races/[id]/draw */
  raceDraw: { name: "race-draw", policy: perMinute(20) },
  /** PATCH /api/races/[id]/filters */
  raceFilters: { name: "race-filters", policy: perMinute(20) },
  /** POST /api/livekit/token */
  livekitToken: { name: "livekit-token", policy: perMinute(20) },
  /** GET /api/problems/availability */
  problemsAvailability: { name: "problems-availability", policy: perMinute(30) },
  /** /api/admin/** */
  admin: { name: "admin", policy: perMinute(120) },
} as const satisfies Record<string, { name: string; policy: RateLimitPolicy }>;

export type RateLimitPolicyKey = keyof typeof RATE_LIMIT_POLICIES;

/**
 * Enforce the named policy for `req`. Key = Clerk userId when `userId` is
 * given (an authed route resolving it cheaply via `auth()`, never a fresh DB
 * lookup), else falls back to per-IP via {@link rateLimitKey}. Returns a
 * ready 429 response to short-circuit the handler, or `null` to proceed.
 */
export function enforcePolicy(
  req: Request,
  policyKey: RateLimitPolicyKey,
  userId: string | null,
): Promise<NextResponse | null> {
  const { name, policy } = RATE_LIMIT_POLICIES[policyKey];
  return enforceRateLimit(req, rateLimitKey(name, userId, req), {
    name,
    policy,
    backend: "memory",
  });
}

/**
 * Admin-route variant of {@link enforcePolicy}: called AFTER `requireAdmin`
 * has already resolved the caller (so `userId` — the admin's DB `id` — is
 * always non-empty here), keying per-admin rather than per-IP. Because the
 * key is always non-empty, `rateLimitKey` never touches the request's
 * headers, so the current zero-arg admin handlers don't need a `req`
 * parameter threaded through just to satisfy the signature — a placeholder
 * is safe and never dereferenced.
 */
export function enforceAdminPolicy(userId: string): Promise<NextResponse | null> {
  return enforcePolicy(new Request("http://localhost/api/admin"), "admin", userId);
}
