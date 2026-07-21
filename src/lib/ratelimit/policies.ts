/**
 * Route-facing rate-limit policies + wiring for the sensitive routes (issue
 * #256).
 *
 * Importing this module (directly or transitively) is what registers the
 * persistent "db" backend: the `import "./db"` below runs `./db.ts`'s
 * module-scope `registerDbBackend(checkDb)` as a side effect. Every route
 * enforced here imports {@link enforceDbRateLimit} from this file rather
 * than reaching for `enforceRateLimit`/`backend: "db"` directly, so the
 * registration always happens before the check runs — no route needs to
 * remember a second import for wiring.
 *
 * Keeps routes thin per CLAUDE.md: a route just calls
 * `enforceDbRateLimit(req, name, userId, POLICY)` and returns the result if
 * non-null. No policy numbers or backend selection live in route files.
 */

import "./db";
import { enforceRateLimit, rateLimitKey } from "./index";
import type { RateLimitPolicy } from "./policy";

const ONE_MINUTE_MS = 60_000;

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
