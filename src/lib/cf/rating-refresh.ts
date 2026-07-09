/**
 * Daily CF-rating refresh (sweep cron).
 *
 * `users.cf_rating` is otherwise a one-time snapshot taken at handle-link time
 * (`POST /api/cf/verify/check`) — nothing updates it afterward, so a player's
 * rating goes stale the moment their real Codeforces rating moves. This module
 * re-reads the current rating for every linked handle from the public CF
 * `user.info` API and writes back only the rows whose rating actually changed.
 *
 * Called once per day from `GET /api/cron/sweep` (Vercel Hobby caps crons at
 * once/day). Batched into as few `user.info` calls as possible because the CF
 * client enforces a ~2s courtesy spacing between requests (see
 * `src/lib/cf/client.ts`). If a batch fails because one handle in it is no
 * longer resolvable (deleted account), it falls back to per-handle lookups so
 * one bad handle can't sink the rest.
 */

import { eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { CfApiError, getUserInfo } from "@/lib/cf/client";

/** Max handles per `user.info` call. CF accepts a large semicolon-separated
 *  list; we chunk conservatively to keep the request URL bounded. */
const HANDLES_PER_CALL = 300;

export interface RatingRefreshResult {
  /** Users with a linked CF handle that we attempted to resolve. */
  checked: number;
  /** Rows whose `cf_rating` differed from CF and were updated. */
  updated: number;
  /** Handles CF could not resolve (deleted account, transient failure). */
  failed: number;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Re-read current CF ratings for every linked handle and persist any changes.
 * CF handles are case-insensitive, so responses are matched to rows by
 * lowercased handle. Returns per-run counts for the cron response.
 */
export async function refreshCfRatings(): Promise<RatingRefreshResult> {
  const linked = await db
    .select({
      id: users.id,
      cfHandle: users.cfHandle,
      cfRating: users.cfRating,
    })
    .from(users)
    .where(isNotNull(users.cfHandle));

  if (linked.length === 0) {
    return { checked: 0, updated: 0, failed: 0 };
  }

  // Lowercased handle -> its row. cfHandle is unique, so no collisions.
  const rowByHandle = new Map<string, { id: string; cfRating: number | null }>();
  const handles: string[] = [];
  for (const u of linked) {
    if (!u.cfHandle) continue;
    rowByHandle.set(u.cfHandle.toLowerCase(), { id: u.id, cfRating: u.cfRating });
    handles.push(u.cfHandle);
  }

  let updated = 0;
  let failed = 0;

  // Resolve one group of handles, updating changed rows. On a CF-level failure
  // for a multi-handle group, recurse per-handle so a single bad handle only
  // costs itself. A single-handle failure is counted and skipped.
  async function resolve(group: string[]): Promise<void> {
    let infos;
    try {
      infos = await getUserInfo(group.join(";"));
    } catch (err) {
      if (!(err instanceof CfApiError)) throw err;
      if (group.length === 1) {
        failed += 1;
        return;
      }
      for (const handle of group) {
        await resolve([handle]);
      }
      return;
    }

    const seen = new Set<string>();
    for (const info of infos) {
      const key = info.handle.toLowerCase();
      seen.add(key);
      const row = rowByHandle.get(key);
      if (!row) continue;
      const next = info.rating ?? null;
      if (next === row.cfRating) continue;
      await db.update(users).set({ cfRating: next }).where(eq(users.id, row.id));
      updated += 1;
    }

    // A handle requested but absent from an OK response couldn't be resolved.
    for (const handle of group) {
      if (!seen.has(handle.toLowerCase())) failed += 1;
    }
  }

  for (const group of chunk(handles, HANDLES_PER_CALL)) {
    await resolve(group);
  }

  return { checked: linked.length, updated, failed };
}
