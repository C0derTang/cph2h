/**
 * POST /api/stripe/webhook — Stripe event sink (source of truth for "paid").
 *
 * Authenticated by Stripe signature (not Clerk — the path is exempted in
 * `src/proxy.ts`). On `checkout.session.completed` it flips the matching
 * `pending` registration to `paid` via a guarded update, so a duplicate
 * delivery is a no-op. Returns 400 on a bad/missing signature.
 */

import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { tournamentRegistrations } from "@/lib/db/schema";
import { getStripe } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }

  // Raw body is required for signature verification.
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch (error) {
    console.error("stripe webhook signature verification failed:", error);
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const checkout = event.data.object;
    const userId = checkout.metadata?.userId;
    if (userId) {
      // Idempotent: only a still-pending row flips; a redelivered event is a no-op.
      await db
        .update(tournamentRegistrations)
        .set({
          status: "paid",
          paidAt: new Date(),
          stripeSessionId: checkout.id,
        })
        .where(
          and(
            eq(tournamentRegistrations.userId, userId),
            eq(tournamentRegistrations.status, "pending"),
          ),
        );
    }
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
