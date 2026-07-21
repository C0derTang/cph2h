/**
 * In-memory fixed-window rate-limit backend (issue #253).
 *
 * Single-process, module-level `Map` — sufficient for the memory backend's
 * job: a best-effort limiter that also serves as the fallback when the
 * wave-10 db backend hasn't been registered (see `./index.ts`). Not shared
 * across serverless instances; a distributed policy needs the db backend.
 *
 * Eviction is lazy, not timer-driven (no `setInterval` in a serverless
 * runtime):
 *  - on every lookup, an expired entry for *that* key is dropped before the
 *    hit is recorded;
 *  - whenever the map grows past {@link SWEEP_THRESHOLD}, a full sweep drops
 *    every expired entry across all keys, so a trickle of one-off keys (e.g.
 *    per-IP) can't grow the map unbounded.
 */

import { applyFixedWindow, type FixedWindowResult, type RateLimitPolicy, type WindowState } from "./policy";

/** Sweep the whole store once it holds more entries than this. */
const SWEEP_THRESHOLD = 10_000;

/** A window's `windowMs` travels with it so expiry can be checked without the caller's policy at hand (e.g. during a sweep touching keys from other policies). */
interface StoredEntry {
  state: WindowState;
  windowMs: number;
}

let store = new Map<string, StoredEntry>();

function isExpired(entry: StoredEntry, nowMs: number): boolean {
  return nowMs >= entry.state.windowStartMs + entry.windowMs;
}

/** Drop every expired entry in the store. */
function sweep(nowMs: number): void {
  for (const [key, entry] of store) {
    if (isExpired(entry, nowMs)) store.delete(key);
  }
}

/**
 * Record one hit for `key` under `policy` at `nowMs` (defaults to
 * `Date.now()`) against the in-memory store.
 */
export function checkMemory(
  key: string,
  policy: RateLimitPolicy,
  nowMs: number = Date.now(),
): FixedWindowResult {
  const existing = store.get(key);
  if (existing && isExpired(existing, nowMs)) {
    // Lazy eviction: this key's window has lapsed, forget it before recording.
    store.delete(key);
  }

  const currentState = store.get(key)?.state ?? null;
  const result = applyFixedWindow(currentState, nowMs, policy);
  store.set(key, { state: result.nextState, windowMs: policy.windowMs });

  if (store.size > SWEEP_THRESHOLD) {
    sweep(nowMs);
  }

  return result;
}

/** Number of keys currently held (test/diagnostic use only). */
export function _memoryStoreSize(): number {
  return store.size;
}

/** Clear the module-level store. Test-only — production never resets it. */
export function _resetMemoryStore(): void {
  store = new Map();
}
