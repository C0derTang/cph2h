/**
 * GET/PUT /api/settings/username — the caller's display name (issue #111).
 *
 * GET returns `users.username` for the signed-in user, falling back to
 * `DEFAULT_USERNAME` if no `users` row exists yet (rows are provisioned on
 * first authenticated access by `ensureUser`, src/lib/user.ts) — mirrors
 * `GET /api/settings/template`.
 *
 * PUT validates `{ username }` (see `usernameSchema`, src/lib/username.ts)
 * and updates the row. Like the template route, PUT intentionally does not
 * create a `users` row: editing your name still requires the row to already
 * exist. `users.username` is not a unique column — no uniqueness check here.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { DEFAULT_USERNAME } from "@/lib/user";
import { usernameSchema } from "@/lib/username";

export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [user] = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);

  return NextResponse.json({ username: user?.username ?? DEFAULT_USERNAME });
}

export async function PUT(request: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let username: string;
  try {
    const body = usernameSchema.parse(await request.json());
    username = body.username;
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? (err.issues[0]?.message ?? "Invalid request body.")
        : "Invalid request body.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const [updated] = await db
    .update(users)
    .set({ username })
    .where(eq(users.clerkId, clerkId))
    .returning({ username: users.username });

  if (!updated) {
    return NextResponse.json(
      {
        error:
          "Link your Codeforces account first — your profile is created when you link.",
      },
      { status: 404 },
    );
  }

  return NextResponse.json({ username: updated.username });
}
