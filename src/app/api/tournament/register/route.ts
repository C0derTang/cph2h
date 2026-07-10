/**
 * POST /api/tournament/register — start tournament registration.
 *
 * Gates on a signed-in user with a linked Codeforces account (reusing
 * `requireLinkedUser`), enforces the 128-player cap and single-registration
 * invariant, then creates a Stripe Checkout session for the $5 entry. A
 * `pending` row is written before checkout; the Stripe webhook flips it to
 * `paid`. The client never mutates payment state.
 */

import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tournamentRegistrations } from "@/lib/db/schema";
import { requireLinkedUser } from "@/lib/race/session";
import { getStripe } from "@/lib/stripe";
import {
  ENTRY_CENTS,
  TOURNAMENT_CAP,
  countPaid,
  getRegistration,
} from "@/lib/tournament";
import type { TournamentRegisterResponse } from "@/lib/types";

export async function POST(
  req: NextRequest,
): Promise<NextResponse<TournamentRegisterResponse>> {
  const session = await requireLinkedUser();
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }
  const { user } = session;

  // Already paid → nothing to do (idempotent from the user's side).
  const existing = await getRegistration(user.id);
  if (existing?.status === "paid") {
    return NextResponse.json({ error: "already_registered" }, { status: 409 });
  }

  // Cap check against confirmed-paid registrants only.
  if ((await countPaid()) >= TOURNAMENT_CAP) {
    return NextResponse.json({ error: "full" }, { status: 409 });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "payments_unavailable" }, { status: 503 });
  }

  // Ensure a pending row exists (idempotent — no-op if one is already there).
  await db
    .insert(tournamentRegistrations)
    .values({ userId: user.id, cfHandle: user.cfHandle ?? "", status: "pending" })
    .onConflictDoNothing();

  const origin = req.nextUrl.origin;
  let checkout;
  try {
    checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: ENTRY_CENTS,
            product_data: { name: "cph2h Tournament Entry" },
          },
        },
      ],
      metadata: { userId: user.id },
      success_url: `${origin}/tournament?paid=1`,
      cancel_url: `${origin}/tournament`,
    });
  } catch (error) {
    console.error("stripe checkout create failed:", error);
    return NextResponse.json({ error: "payments_unavailable" }, { status: 503 });
  }

  // Record the session id on the pending row for reconciliation.
  await db
    .update(tournamentRegistrations)
    .set({ stripeSessionId: checkout.id })
    .where(eq(tournamentRegistrations.userId, user.id));

  if (!checkout.url) {
    return NextResponse.json({ error: "payments_unavailable" }, { status: 503 });
  }
  return NextResponse.json({ url: checkout.url }, { status: 200 });
}
