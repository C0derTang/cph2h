/**
 * Live activity counters for the queue page (see GET /api/presence).
 *
 * There's no global presence/heartbeat, so "online" is derived from the two
 * things the platform actually tracks: who is in an active race and who is
 * freshly in the matchmaking queue.
 *
 *  - `playing` = distinct participants of in-window active races.
 *  - `online`  = `playing` ∪ distinct users with a *fresh* queue row.
 *
 * Both use freshness filters because the safety-net sweep (which purges stale
 * queue rows and resolves overdue active races) only runs daily — so without
 * these filters a closed tab would inflate the counts for up to a day. We
 * count only queue rows enqueued within {@link QUEUE_FRESH_MS} (matching the
 * sweep's own 5-minute stale threshold) and active races still within their
 * `endsAt` window.
 */

import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { queueEntries, races } from "@/lib/db/schema";
import type { PresenceCounts } from "@/lib/types";

/** Queue rows enqueued more than this long ago are treated as ghosts (a closed
 *  tab that never left the queue) and excluded — matches the sweep's threshold. */
export const QUEUE_FRESH_MS = 5 * 60 * 1000;

export async function getPresenceCounts(): Promise<PresenceCounts> {
  // In-window active races: exclude overdue ghosts the daily sweep hasn't
  // resolved yet (endsAt in the past). A null endsAt is kept defensively.
  const activeRows = await db
    .select({ p1: races.p1Id, p2: races.p2Id })
    .from(races)
    .where(
      and(
        eq(races.status, "active"),
        or(isNull(races.endsAt), gt(races.endsAt, sql`now()`)),
      ),
    );

  const playing = new Set<string>();
  for (const row of activeRows) {
    playing.add(row.p1);
    if (row.p2) playing.add(row.p2);
  }

  // Fresh queue rows only.
  const queuedRows = await db
    .select({ userId: queueEntries.userId })
    .from(queueEntries)
    .where(
      gt(
        queueEntries.enqueuedAt,
        sql`now() - (${QUEUE_FRESH_MS / 1000} * interval '1 second')`,
      ),
    );

  const online = new Set(playing);
  for (const row of queuedRows) online.add(row.userId);

  return { online: online.size, playing: playing.size };
}
