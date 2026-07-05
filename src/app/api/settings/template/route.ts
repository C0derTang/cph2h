/**
 * GET/PUT /api/settings/template — the caller's saved C++ boilerplate
 * (issue #12).
 *
 * GET returns `users.cppTemplate` for the signed-in user, falling back to
 * `DEFAULT_CPP_TEMPLATE` if no `users` row exists yet (rows are provisioned on
 * first authenticated access by `ensureUser`, src/lib/user.ts).
 *
 * PUT validates `{ template }` (size-capped, see `templateSchema`) and
 * updates the row. This route intentionally does not create a `users` row:
 * unlike race actions, editing a template doesn't require a linked CF
 * account, but it does require the row to already exist — a PUT before any
 * row exists returns 404 with a message pointing at the CF link flow.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { templateSchema } from "@/lib/editor/template";
import { DEFAULT_CPP_TEMPLATE } from "@/lib/types";

export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [user] = await db
    .select({ cppTemplate: users.cppTemplate })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);

  return NextResponse.json({ template: user?.cppTemplate ?? DEFAULT_CPP_TEMPLATE });
}

export async function PUT(request: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let template: string;
  try {
    const body = templateSchema.parse(await request.json());
    template = body.template;
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? (err.issues[0]?.message ?? "Invalid request body.")
        : "Invalid request body.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const [updated] = await db
    .update(users)
    .set({ cppTemplate: template })
    .where(eq(users.clerkId, clerkId))
    .returning({ cppTemplate: users.cppTemplate });

  if (!updated) {
    return NextResponse.json(
      {
        error:
          "Link your Codeforces account first — your profile is created when you link.",
      },
      { status: 404 },
    );
  }

  return NextResponse.json({ template: updated.cppTemplate });
}
