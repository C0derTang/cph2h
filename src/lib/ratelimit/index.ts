/**
 * Route-facing rate-limit helper (issue #253).
 *
 * This issue ships the library only — no route wires it up yet. Wave-10
 * integrates it into routes and adds the persistent "db" backend via
 * {@link registerDbBackend}; until that registration happens, requesting the
 * "db" backend here silently (with a `console.warn`) falls back to the
 * in-memory backend so callers can opt into `backend: "db"` ahead of time
 * without breaking.
 */

import { NextResponse } from "next/server";
import { checkMemory } from "./memory";
import type { FixedWindowResult, RateLimitPolicy } from "./policy";

export type { RateLimitPolicy, WindowState, FixedWindowResult } from "./policy";
export { applyFixedWindow } from "./policy";
export { checkMemory, _resetMemoryStore } from "./memory";

export type RateLimitBackend = "memory" | "db";

/**
 * Shape a db backend must satisfy to register via {@link registerDbBackend}.
 * Mirrors {@link checkMemory}'s signature so the two are interchangeable
 * behind {@link enforceRateLimit}. May return synchronously or async.
 */
export type BackendCheckFn = (
  key: string,
  policy: RateLimitPolicy,
  nowMs?: number,
) => FixedWindowResult | Promise<FixedWindowResult>;

let dbBackend: BackendCheckFn | null = null;

/**
 * Wave-10 seam: register the persistent "db" backend. Call once at module
 * load (e.g. from `src/lib/ratelimit/db.ts`'s own module scope) so any route
 * requesting `backend: "db"` starts hitting the real store.
 */
export function registerDbBackend(fn: BackendCheckFn): void {
  dbBackend = fn;
}

/** Clear a registered db backend. Test-only. */
export function _resetDbBackend(): void {
  dbBackend = null;
}

async function checkBackend(
  backend: RateLimitBackend,
  key: string,
  policy: RateLimitPolicy,
): Promise<FixedWindowResult> {
  if (backend === "db") {
    if (dbBackend) return dbBackend(key, policy);
    console.warn(
      `[ratelimit] "db" backend requested for key "${key}" but no db backend is registered; falling back to memory`,
    );
  }
  return checkMemory(key, policy);
}

/**
 * Derive a rate-limit key for `name`, preferring a signed-in `userId`, then
 * the first hop of `x-forwarded-for` (proxies append hops — the first is the
 * original client), then `x-real-ip`, then the literal `"anon"` when no
 * caller identity is available at all.
 */
export function rateLimitKey(name: string, userId: string | null, req: Request): string {
  if (userId) return `${name}:user:${userId}`;

  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstHop = forwardedFor.split(",")[0]?.trim();
    if (firstHop) return `${name}:ip:${firstHop}`;
  }

  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return `${name}:ip:${realIp}`;

  return `${name}:ip:anon`;
}

/**
 * Enforce `opts.policy` for `key` against `opts.backend` (defaults to
 * `"memory"`). Returns a ready `429 { error: "rate_limited" }` response with
 * a `Retry-After` header (whole seconds, rounded up) when the caller is over
 * the limit, or `null` when the request may proceed.
 *
 * Fails open: any backend error is caught, logged via `console.warn`, and
 * treated as `allowed` — a rate limiter must never be the reason a request
 * 500s.
 */
export async function enforceRateLimit(
  req: Request,
  key: string,
  opts: { name: string; policy: RateLimitPolicy; backend?: RateLimitBackend },
): Promise<NextResponse | null> {
  let result: FixedWindowResult;
  try {
    result = await checkBackend(opts.backend ?? "memory", key, opts.policy);
  } catch (err) {
    console.warn(`[ratelimit] backend error for "${opts.name}" (key "${key}"); failing open`, err);
    return null;
  }

  if (result.allowed) return null;

  const retryAfterSec = Math.ceil(result.retryAfterMs / 1000);
  return NextResponse.json(
    { error: "rate_limited" },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}
