/**
 * GET /api/admin/users — searchable user directory (issue #224).
 *
 * `requireAdmin` runs first: non-admins (and signed-out callers) get 404.
 */

import { NextResponse } from "next/server";
import { listDirectoryUsers } from "@/lib/admin/directory-db";
import { requireAdmin } from "@/lib/race/session";
import { enforceAdminPolicy } from "@/lib/ratelimit/policies";

export async function GET() {
  const session = await requireAdmin();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const limited = await enforceAdminPolicy(session.user.id);
  if (limited) return limited;

  const users = await listDirectoryUsers();
  return NextResponse.json(users, { status: 200 });
}
