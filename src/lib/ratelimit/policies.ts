/**
 * Named rate-limit policies for hot/polling routes (issue #257).
 *
 * Single source of truth for every route's limit — routes reference an entry
 * here by key instead of hardcoding `{ limit, windowMs }` inline. All windows
 * are one minute; see the issue for the legit-client-rate rationale (each
 * limit is a 2-4x-headroom multiple of an authentic client's call rate).
 *
 * `enforcePolicy` is the route-facing helper: it derives the key (Clerk
 * userId when authed, else per-IP) and enforces the named policy against the
 * in-memory backend in one call, so routes stay a one-liner.
 */

import { NextResponse } from "next/server";
import { enforceRateLimit, rateLimitKey, type RateLimitPolicy } from "./index";

const perMinute = (limit: number): RateLimitPolicy => ({ limit, windowMs: 60_000 });

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
