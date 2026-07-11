/**
 * Known-cheater blocklist (issue #184), sourced from the community
 * cf-cheater-highlighter project's exported list of confirmed Codeforces
 * cheaters. Enforced at two entry points: linking
 * (`/api/cf/oauth/callback`) and racing (`POST /api/queue`, `POST
 * /api/races`) — not at polls/snapshots/admin, so an already-queued or
 * already-racing user is never disrupted mid-flow.
 *
 * **Fail-open by design**: platform availability must never depend on
 * GitHub's uptime. Any fetch/parse failure returns `null` from
 * {@link getCheaterSet}, and every caller treats `null` as "allow" — a
 * GitHub outage must never block linking or racing. Failures are logged via
 * `console.warn` so an outage is still visible in server logs.
 *
 * {@link parseCheaterList} is pure (validate shape, lowercase every handle —
 * CF handles are case-insensitive and the source list is mixed case) and
 * exhaustively unit tested. {@link getCheaterSet} wraps it with a
 * module-level in-memory cache (6h TTL) so a warm serverless instance
 * fetches the ~5k-handle list at most once per TTL window, never per-render
 * or per-request. A fresh instance (cold start) refetches once — that's
 * fine, the list barely changes.
 */

const CHEATER_LIST_URL =
  "https://raw.githubusercontent.com/macaquedev/cf-cheater-highlighter/main/cheaters.json";

/** How long a successful fetch is cached before the next call refetches. */
export const CHEATER_LIST_TTL_MS = 6 * 60 * 60 * 1000;

interface CheaterListCache {
  set: Set<string>;
  expiresAt: number;
}

/** Module-level cache — shared across requests within a warm instance. */
let cache: CheaterListCache | null = null;

/**
 * Validate + normalize the raw JSON payload: `{ cheaters: string[],
 * lastExportTime: string }`. Every handle is lowercased. Returns `null` on
 * any shape mismatch. Pure — no I/O.
 */
export function parseCheaterList(json: unknown): Set<string> | null {
  if (typeof json !== "object" || json === null) return null;

  const { cheaters, lastExportTime } = json as Record<string, unknown>;
  if (typeof lastExportTime !== "string") return null;
  if (!Array.isArray(cheaters)) return null;
  if (!cheaters.every((h) => typeof h === "string")) return null;

  return new Set(cheaters.map((h) => h.toLowerCase()));
}

/**
 * Fetch + cache the cheater set. Fail-open: returns `null` (never throws) on
 * any network/HTTP/parse failure. A failure is NOT cached, so the next call
 * (even within the TTL window) retries the fetch rather than being stuck
 * fail-open for a full 6h window on a transient blip.
 */
export async function getCheaterSet(): Promise<Set<string> | null> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.set;

  let json: unknown;
  try {
    const response = await fetch(CHEATER_LIST_URL);
    if (!response.ok) {
      console.warn(`[cheaters] fetch failed: HTTP ${response.status}`);
      return null;
    }
    json = await response.json();
  } catch (err) {
    console.warn("[cheaters] fetch threw", err);
    return null;
  }

  const set = parseCheaterList(json);
  if (!set) {
    console.warn("[cheaters] fetch returned a malformed cheater list");
    return null;
  }

  cache = { set, expiresAt: now + CHEATER_LIST_TTL_MS };
  return set;
}

/** Case-insensitive membership check against an already-fetched set. */
export function isKnownCheater(handle: string, set: Set<string>): boolean {
  return set.has(handle.toLowerCase());
}
