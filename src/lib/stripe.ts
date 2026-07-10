/**
 * Lazy Stripe client.
 *
 * Returns `null` when `STRIPE_SECRET_KEY` is unset so the app builds and runs
 * without payment keys — the register route degrades to a 503 instead of
 * crashing. Instantiated once on first use and memoized.
 */

import Stripe from "stripe";

let client: Stripe | null = null;

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  client ??= new Stripe(key);
  return client;
}
