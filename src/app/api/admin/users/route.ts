/**
 * GET /api/admin/users — searchable user directory (issue #224).
 *
 * `requireAdmin` runs first: non-admins (and signed-out callers) get 404.
 */

import { NextResponse } from "next/server";
import { listDirectoryUsers } from "@/lib/admin/directory-db";
import { requireAdmin } from "@/lib/race/session";

export async function GET() {
  const session = await requireAdmin();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const users = await listDirectoryUsers();
  return NextResponse.json(users, { status: 200 });
}
