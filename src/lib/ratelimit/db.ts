/**
 * Persistent, cross-instance rate-limit backend (issue #256).
 *
 * Backs the `"db"` backend option on `enforceRateLimit` (`./index.ts`) with
 * the `api_rate_limits` table (schema added by #251): a fixed-window counter
 * keyed by `key`, advanced with a single atomic upsert so concurrent
 * serverless instances never race each other on the same key. The Neon HTTP
 * driver has no interactive transactions (see CLAUDE.md), so this must stay
 * one statement — `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING`, with
 * the window-reset decision expressed as `CASE` on the existing row rather
 * than a read-then-write.
 *
 * Uses the database's own `now()` for every time comparison (not the
 * caller's `nowMs`) — the whole point of the db backend is a shared clock
 * across instances, and trusting each instance's local clock would defeat
 * that. `nowMs` is therefore not part of {@link checkDb}'s signature; it is
 * still structurally assignable to `BackendCheckFn` (TS allows a callback
 * with fewer parameters than the type it's assigned to).
 *
 * Registers itself as the "db" backend at module load — importing this
 * module for its side effect (see `./policies.ts`) is what wires it up. Any
 * route that wants `backend: "db"` must import (directly or transitively)
 * something that imports `./db`, or `enforceRateLimit` silently falls back
 * to the in-memory backend (with a `console.warn`).
 *
 * Fails open on any DB error: a rate limiter must never be the reason a
 * request 500s (mirrors `enforceRateLimit`'s own fail-open contract, and
 * covers the case where the db backend throws before that wrapper's own
 * try/catch — e.g. a malformed row).
 */

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { registerDbBackend } from "./index";
import type { FixedWindowResult, RateLimitPolicy } from "./policy";

/** Row shape returned by the upsert's `RETURNING` clause. */
interface DbRateLimitRow {
  count: unknown;
  window_start: unknown;
  db_now: unknown;
}

function toMs(value: unknown): number {
  return value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
}

/**
 * Record one hit for `key` under `policy` against the `api_rate_limits`
 * table and report whether it's within the limit.
 *
 * Single atomic statement: a fresh row starts the window at `count = 1`; an
 * existing row whose `window_start` is still within `policy.windowMs` of
 * `now()` gets incremented in place; one whose window has elapsed resets to
 * `count = 1` with a fresh `window_start` — all decided server-side via
 * `CASE`, so two concurrent hits for the same key never both "win" a window
 * reset.
 */
export async function checkDb(
  key: string,
  policy: RateLimitPolicy,
): Promise<FixedWindowResult> {
  const result = await db.execute(sql`
    INSERT INTO api_rate_limits (key, window_start, count) VALUES (${key}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN api_rate_limits.window_start <= now() - (${policy.windowMs} * interval '1 millisecond')
                   THEN 1 ELSE api_rate_limits.count + 1 END,
      window_start = CASE WHEN api_rate_limits.window_start <= now() - (${policy.windowMs} * interval '1 millisecond')
                   THEN now() ELSE api_rate_limits.window_start END
    RETURNING count, window_start, now() AS db_now
  `);

  const row = (result.rows?.[0] ?? null) as unknown as DbRateLimitRow | null;
  if (!row) {
    // An upsert with RETURNING always yields exactly one row; a missing row
    // means something unexpected happened downstream (driver quirk, etc).
    // Fail open rather than let a rate limiter crash the request.
    console.warn(`[ratelimit/db] upsert for key "${key}" returned no row; failing open`);
    return {
      allowed: true,
      retryAfterMs: 0,
      remaining: policy.limit - 1,
      nextState: { windowStartMs: Date.now(), count: 1 },
    };
  }

  const count = Number(row.count);
  const windowStartMs = toMs(row.window_start);
  const dbNowMs = toMs(row.db_now);

  const allowed = count <= policy.limit;
  const retryAfterMs = allowed ? 0 : Math.max(0, windowStartMs + policy.windowMs - dbNowMs);
  const remaining = Math.max(0, policy.limit - count);

  return { allowed, retryAfterMs, remaining, nextState: { windowStartMs, count } };
}

registerDbBackend(checkDb);
