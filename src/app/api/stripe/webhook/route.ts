/**
 * POST /api/stripe/webhook — Stripe event sink (source of truth for "paid").
 *
 * Authenticated by Stripe signature (not Clerk — the path is exempted in
 * `src/proxy.ts`). On `checkout.session.completed` it flips the matching
 * `pending` registration to `paid` via a guarded update, so a duplicate
 * delivery is a no-op. Returns 400 on a bad/missing signature.
 */

import { NextResponse, type NextRequest } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { tournamentRegistrations } from "@/lib/db/schema";
import { getStripe } from "@/lib/stripe";
import { TOURNAMENT_CAP } from "@/lib/tournament";

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
      // Promote pending -> paid, but ONLY while the paid field is under the
      // cap. The cap subquery is evaluated inside the same UPDATE statement, so
      // this is the real seat-granting gate (the register-time check is only an
      // early reject — checkouts in flight can outrun it). Neon-HTTP-safe:
      // single atomic statement, no interactive transaction.
      const promoted = await db
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
            sql`(select count(*) from ${tournamentRegistrations} where ${tournamentRegistrations.status} = 'paid') < ${TOURNAMENT_CAP}`,
          ),
        )
        .returning({ userId: tournamentRegistrations.userId });

      if (promoted.length === 0) {
        // No seat granted. Two cases to disambiguate — only one warrants a refund:
        //   - row already `paid`  -> redelivered event, idempotent no-op.
        //   - row still `pending` -> cap was full; the user paid for a seat that
        //     doesn't exist, so refund the charge and leave them unregistered.
        const [row] = await db
          .select({ status: tournamentRegistrations.status })
          .from(tournamentRegistrations)
          .where(eq(tournamentRegistrations.userId, userId))
          .limit(1);

        if (row?.status === "pending") {
          const paymentIntent =
            typeof checkout.payment_intent === "string"
              ? checkout.payment_intent
              : checkout.payment_intent?.id;
          if (paymentIntent) {
            try {
              await stripe.refunds.create({ payment_intent: paymentIntent });
              console.warn(
                `tournament over-cap: refunded ${userId} (session ${checkout.id})`,
              );
            } catch (error) {
              // Refund failed — surface loudly for manual reconciliation.
              console.error(
                `tournament over-cap refund FAILED for ${userId} (session ${checkout.id}):`,
                error,
              );
            }
          }
        }
      }
    }
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
