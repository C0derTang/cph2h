/**
 * Cross-instance Codeforces slot pacing.
 *
 * Serverless instances share no in-process state, so the per-instance courtesy
 * limiter in `src/lib/cf/client.ts` alone cannot bound the *aggregate* rate at
 * which the whole deployment hits codeforces.com. This module pushes the pacing
 * decision into a single Postgres row (`cf_rate_limiter`, id = 1): every
 * outbound CF request claims the next 2s slot with one atomic `UPDATE`, so N
 * concurrent instances serialize on the row lock and collectively honour CF's
 * ~1 request / 2s courtesy limit.
 *
 * ## Atomicity (Neon HTTP driver)
 *
 * The Neon HTTP driver has no interactive transactions, so the claim is a single
 * statement whose row lock (implicit for the `UPDATE`) serializes concurrent
 * claimers:
 *
 * ```sql
 * UPDATE cf_rate_limiter
 * SET next_slot_at = GREATEST(next_slot_at, now()) + interval '2000 milliseconds'
 * WHERE id = 1
 * RETURNING <slot_at>, <db_now>;
 * ```
 *
 * `slot_at = next_slot_at - 2000ms` (the slot this caller just took), `waitMs =
 * slot_at - db_now` computed on the DB clock so serverless clock skew is
 * irrelevant. `GREATEST(next_slot_at, now())` means idle periods bank no credit
 * — a long-quiet limiter releases a request immediately rather than firing a
 * burst.
 *
 * ## Wiring
 *
 * `claimCfSlot` matches the CF client's `SlotClaimer` seam and installs itself
 * as the client's claimer on import (bottom of this file). Production code loads
 * this module via `src/lib/cf/client.ts`, which dynamically imports it at module
 * init outside of unit tests (see the note there). On any failure the claimer
 * *fails open*: it resolves with `{ fallback: true }` so the client applies its
 * local 2s spacing for that attempt rather than blocking all CF traffic when the
 * DB is unreachable.
 */

import { sql } from "drizzle-orm";

import { setSlotClaimer, type SlotClaimResult } from "@/lib/cf/client";

/** Backpressure ceiling (ms): a claimed wait above this is refused, not slept. */
export const MAX_SLOT_WAIT_MS = 15_000;

/**
 * Thrown when the claimed slot is more than `MAX_SLOT_WAIT_MS` in the future.
 * The claim is given back (best effort) before throwing so it is not wasted.
 * Callers already tolerate a per-call CF failure (verdict polling catches per
 * player; statement pre-cache is best-effort), so this surfaces as one skipped
 * call rather than a blocked queue.
 */
export class CfBackpressureError extends Error {
  readonly waitMs: number;
  constructor(waitMs: number) {
    super(
      `Codeforces slot backpressure: claimed wait ${waitMs}ms exceeds ${MAX_SLOT_WAIT_MS}ms cap`,
    );
    this.name = "CfBackpressureError";
    this.waitMs = waitMs;
  }
}

// ---------------------------------------------------------------------------
// Abort-aware sleep (self-contained so the limiter is unit-testable without the
// client). Mirrors the client's helpers.
// ---------------------------------------------------------------------------

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError(signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    if (!signal) {
      setTimeout(resolve, ms);
      return;
    }
    let onAbort = () => undefined;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    onAbort = () => {
      clearTimeout(timeout);
      cleanup();
      reject(abortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// ---------------------------------------------------------------------------
// Pure pacing math
// ---------------------------------------------------------------------------

export interface SlotWait {
  /** Non-negative ms to wait until the claimed slot (0 if already due/past). */
  waitMs: number;
  /** True when `waitMs` exceeds `maxWaitMs` — the caller should give back + refuse. */
  overCap: boolean;
}

/**
 * Pure: derive the wait for a claimed slot from the DB-clock instants (both in
 * epoch ms). A slot at or before `dbNowMs` yields `0`; a future slot yields the
 * delta; `overCap` flags a wait beyond `maxWaitMs` (backpressure).
 */
export function computeSlotWait(
  slotAtMs: number,
  dbNowMs: number,
  maxWaitMs: number,
): SlotWait {
  const waitMs = Math.max(0, slotAtMs - dbNowMs);
  return { waitMs, overCap: waitMs > maxWaitMs };
}

// ---------------------------------------------------------------------------
// DB seam (injectable for unit tests; DI style of src/lib/race/hooks.ts)
// ---------------------------------------------------------------------------

/** Result of one atomic slot claim, on the DB clock (epoch ms). */
export interface ClaimResult {
  slotAtMs: number;
  dbNowMs: number;
}

/** Runs the atomic claim `UPDATE`. `null` = the seed row was missing (0 rows). */
export type ClaimFn = () => Promise<ClaimResult | null>;
/** Returns the last-claimed 2s slot to the row (best effort). */
export type GiveBackFn = () => Promise<void>;
/** Seeds the singleton row if absent (`INSERT ... ON CONFLICT DO NOTHING`). */
export type SeedFn = () => Promise<void>;

interface LimiterDeps {
  claim: ClaimFn;
  giveBack: GiveBackFn;
  seed: SeedFn;
}

/**
 * Atomic claim: advance `next_slot_at` to `GREATEST(next_slot_at, now()) + 2s`
 * and return the slot this caller took plus the DB clock, both as epoch ms so no
 * timestamp string parsing (and no serverless clock) is involved.
 */
const dbClaim: ClaimFn = async () => {
  const { db } = await import("@/lib/db");
  const result = await db.execute(sql`
    UPDATE cf_rate_limiter
    SET next_slot_at = GREATEST(next_slot_at, now()) + interval '2000 milliseconds'
    WHERE id = 1
    RETURNING
      extract(epoch from (next_slot_at - interval '2000 milliseconds')) * 1000 AS slot_at_ms,
      extract(epoch from now()) * 1000 AS db_now_ms
  `);
  const rows = (result.rows ?? []) as {
    slot_at_ms: number | string;
    db_now_ms: number | string;
  }[];
  if (rows.length === 0) return null;
  return {
    slotAtMs: Number(rows[0].slot_at_ms),
    dbNowMs: Number(rows[0].db_now_ms),
  };
};

const dbGiveBack: GiveBackFn = async () => {
  const { db } = await import("@/lib/db");
  await db.execute(sql`
    UPDATE cf_rate_limiter
    SET next_slot_at = GREATEST(now(), next_slot_at - interval '2000 milliseconds')
    WHERE id = 1
  `);
};

const dbSeed: SeedFn = async () => {
  const { db } = await import("@/lib/db");
  await db.execute(sql`
    INSERT INTO cf_rate_limiter (id, next_slot_at)
    VALUES (1, now())
    ON CONFLICT (id) DO NOTHING
  `);
};

const dbDeps: LimiterDeps = { claim: dbClaim, giveBack: dbGiveBack, seed: dbSeed };
let activeDeps: LimiterDeps = dbDeps;

/** Override the DB seam (unit tests inject fakes; DI style of hooks.ts). */
export function setLimiterDeps(overrides: Partial<LimiterDeps>): void {
  activeDeps = { ...dbDeps, ...overrides };
}

/** Restore the real DB-backed seam. */
export function resetLimiterDeps(): void {
  activeDeps = dbDeps;
}

async function bestEffortGiveBack(): Promise<void> {
  try {
    await activeDeps.giveBack();
  } catch (err) {
    console.warn("[cf-limiter] slot give-back failed", err);
  }
}

// ---------------------------------------------------------------------------
// The claimer
// ---------------------------------------------------------------------------

export interface ClaimCfSlotOptions {
  signal?: AbortSignal;
  /** Backpressure ceiling override (defaults to `MAX_SLOT_WAIT_MS`). */
  maxWaitMs?: number;
}

/**
 * Claim one global CF slot and wait (abort-aware) until it is due.
 *
 * Contract (matches the client's `SlotClaimer` seam):
 *  - Resolves with `void` when it handled pacing (the caller must issue exactly
 *    one CF request now).
 *  - Resolves with `{ fallback: true }` when it *fails open* — the claim query
 *    threw (DB unreachable) or the row is still missing after a seed — so the
 *    client applies its local 2s spacing for this attempt instead of blocking.
 *  - Throws `CfBackpressureError` when the claimed wait exceeds `maxWaitMs`
 *    (after giving the slot back).
 *  - Rethrows an `AbortError` if `signal` aborts while waiting (after giving the
 *    slot back so the abandoned slot is not wasted).
 *
 * If the claim `UPDATE` returns 0 rows the singleton row is missing; it is
 * seeded (`ON CONFLICT DO NOTHING`) and the claim retried once.
 */
export async function claimCfSlot(
  opts: ClaimCfSlotOptions = {},
): Promise<SlotClaimResult | void> {
  const { signal } = opts;
  const maxWaitMs = opts.maxWaitMs ?? MAX_SLOT_WAIT_MS;
  throwIfAborted(signal);

  let claim: ClaimResult | null;
  try {
    claim = await activeDeps.claim();
    if (claim === null) {
      // Seed row missing — create it, then retry the claim exactly once.
      await activeDeps.seed();
      claim = await activeDeps.claim();
    }
  } catch (err) {
    // Fail open: never let a DB outage block all outbound CF traffic.
    console.warn(
      "[cf-limiter] slot claim failed; falling back to local spacing",
      err,
    );
    return { fallback: true };
  }

  if (claim === null) {
    console.warn(
      "[cf-limiter] slot row still missing after seed; falling back to local spacing",
    );
    return { fallback: true };
  }

  const { waitMs, overCap } = computeSlotWait(claim.slotAtMs, claim.dbNowMs, maxWaitMs);
  if (overCap) {
    await bestEffortGiveBack();
    throw new CfBackpressureError(waitMs);
  }

  if (waitMs > 0) {
    try {
      await sleep(waitMs, signal);
    } catch (err) {
      // Aborted mid-wait: give the slot back before propagating.
      await bestEffortGiveBack();
      throw err;
    }
  }
  // Handled pacing; returning void => the client skips local spacing.
}

// Wire this DB-backed claimer into the CF client as the global slot claimer.
// Importing this module (production does so from the client outside of tests)
// is all it takes for every cfFetch attempt to claim a cross-instance slot.
setSlotClaimer(claimCfSlot);
