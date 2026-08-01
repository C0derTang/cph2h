/**
 * Shared "does this user have an in-flight race" lookup (issue #309).
 *
 * Extracted verbatim from `src/app/api/queue/route.ts` — both the queue
 * route (single-instance guard + matched-poll fallback) and the dashboard
 * resume banner need the exact same definition of "active": a `ready` or
 * `active` race, newest first. Any drift here changes the queue's 409 guard,
 * so keep the statuses/order/limit identical to the original.
 */

import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { races } from "@/lib/db/schema";

/** Newest race the given user is part of that is still ready/active, if any. */
export async function findActiveRaceId(meId: string): Promise<string | null> {
  const [race] = await db
    .select({ id: races.id })
    .from(races)
    .where(
      and(
        or(eq(races.p1Id, meId), eq(races.p2Id, meId)),
        inArray(races.status, ["ready", "active"]),
      ),
    )
    .orderBy(desc(races.createdAt))
    .limit(1);
  return race?.id ?? null;
}
