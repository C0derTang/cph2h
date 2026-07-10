/**
 * GET /api/presence — live activity counters for the queue page.
 *
 * Returns {@link PresenceCounts} (queued / playing). Non-sensitive aggregate
 * numbers; the route sits behind the default Clerk gate (proxy.ts) like the
 * rest of the app, which is fine because only signed-in users reach /queue.
 */

import { NextResponse } from "next/server";
import { getPresenceCounts } from "@/lib/presence-counts";
import type { PresenceCounts } from "@/lib/types";

export async function GET() {
  const counts: PresenceCounts = await getPresenceCounts();
  return NextResponse.json(counts, { status: 200 });
}
