/**
 * Pure fixed-window rate-limit math (issue #253).
 *
 * No I/O and no clock reads here — callers pass `nowMs` explicitly, so this
 * module is fully deterministic and unit-testable in isolation. Both the
 * in-memory backend (`./memory.ts`) and the future wave-10 db backend apply
 * the same {@link applyFixedWindow} function to whatever window state they
 * persist.
 */

/** A named limit: at most `limit` hits per rolling `windowMs`-long window. */
export interface RateLimitPolicy {
  /** Max allowed hits per window (inclusive — the `limit`-th hit still passes). */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

/** Persisted fixed-window counter for a single rate-limit key. */
export interface WindowState {
  /** Epoch ms the current window started. */
  windowStartMs: number;
  /** Hits recorded in the current window (including the triggering hit). */
  count: number;
}

export interface FixedWindowResult {
  /** `true` iff this hit is within the policy's limit. */
  allowed: boolean;
  /** Ms until the current window ends; `0` when `allowed`. */
  retryAfterMs: number;
  /** Hits left in the current window after this one, floored at 0. */
  remaining: number;
  /** Window state to persist for the next call. */
  nextState: WindowState;
}

/**
 * Record one hit against `state` at `nowMs` under `policy`.
 *
 * - `state === null`, or the current window has elapsed (`nowMs >=
 *   windowStartMs + windowMs`): start a fresh window at `nowMs` with count 1.
 * - Otherwise: increment the existing window's count.
 *
 * Callers persist `nextState` and reuse it (or `null` after eviction) as the
 * `state` argument on the following call — this function itself has no
 * memory of previous calls.
 */
export function applyFixedWindow(
  state: WindowState | null,
  nowMs: number,
  policy: RateLimitPolicy,
): FixedWindowResult {
  const { limit, windowMs } = policy;

  const expired = state === null || nowMs >= state.windowStartMs + windowMs;
  const nextState: WindowState = expired
    ? { windowStartMs: nowMs, count: 1 }
    : { windowStartMs: state.windowStartMs, count: state.count + 1 };

  const allowed = nextState.count <= limit;
  const retryAfterMs = allowed ? 0 : nextState.windowStartMs + windowMs - nowMs;
  const remaining = Math.max(0, limit - nextState.count);

  return { allowed, retryAfterMs, remaining, nextState };
}
