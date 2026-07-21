/**
 * Typed Codeforces public-API client.
 *
 * Wraps the unauthenticated `https://codeforces.com/api/*` endpoints with:
 *  - Envelope parsing (`{status, result}` / `{status, comment}`) and a typed
 *    `CfApiError` on `status: "FAILED"`.
 *  - HTTP-level hardening: a 429/503 response (often an HTML body, not JSON) is
 *    surfaced as a typed `CfRateLimitError` (honoring `Retry-After`) instead of
 *    crashing with a JSON-parse error; other non-OK non-JSON responses become a
 *    typed, non-retryable `CfHttpError`.
 *  - Courtesy rate limiting: a module-level promise chain that guarantees at
 *    least `MIN_REQUEST_SPACING_MS` between request *starts* (CF's public API
 *    allows ~1 request / 2s). Queued requests can be aborted before they spend
 *    a CF request slot.
 *  - A bounded retry loop (`MAX_CF_ATTEMPTS`) with exponential backoff + jitter
 *    when CF reports its own rate limit — either at the HTTP level
 *    (`CfRateLimitError`) or in a FAILED envelope whose comment contains
 *    "limit exceeded".
 */

import type { CfProblem, CfSubmission } from "@/lib/types";

const CF_API_BASE = "https://codeforces.com/api";

/** Minimum spacing (ms) enforced between the *start* of successive requests. */
export const MIN_REQUEST_SPACING_MS = 2000;

/** Backoff (ms) floor at retry index 0 (`5000 * 2**0`). Kept for callers/back-compat. */
export const RETRY_BACKOFF_MS = 5000;

/** Total attempts per `cfFetch` call: 1 initial + 2 retries. */
export const MAX_CF_ATTEMPTS = 3;

/** Ceiling for the exponential-backoff term, before jitter. */
const MAX_BACKOFF_MS = 30000;

export class CfApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CfApiError";
  }
}

/**
 * Thrown when Codeforces returns an HTTP 429 or 503 (its own rate-limit / busy
 * signal). Retryable. `retryAfterMs` is the parsed `Retry-After` header (integer
 * seconds or an HTTP-date), or `undefined` when the header is absent/unparseable.
 */
export class CfRateLimitError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;
  constructor(status: number, retryAfterMs?: number) {
    super(
      retryAfterMs !== undefined
        ? `Codeforces rate limited (HTTP ${status}, retry after ${retryAfterMs}ms)`
        : `Codeforces rate limited (HTTP ${status})`,
    );
    this.name = "CfRateLimitError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Thrown for a non-OK HTTP response that is neither a rate limit (429/503) nor a
 * JSON CF envelope — e.g. a 404/5xx HTML error page. Non-retryable.
 */
export class CfHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Codeforces HTTP ${status}`);
    this.name = "CfHttpError";
    this.status = status;
  }
}

interface CfOkEnvelope<T> {
  status: "OK";
  result: T;
}

interface CfFailedEnvelope {
  status: "FAILED";
  comment: string;
}

type CfEnvelope<T> = CfOkEnvelope<T> | CfFailedEnvelope;

export interface CfFetchOptions {
  signal?: AbortSignal;
}

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
// Courtesy rate limiter
//
// `requestQueue` is a promise chain: each call appends its work after the
// previous one settles. This serializes all cfFetch calls. Before each fetch
// attempt (including retries) the enqueued task awaits a *slot claimer*, which
// by default waits out whatever remains of the `MIN_REQUEST_SPACING_MS` window
// since the last request *started*, guaranteeing the spacing regardless of how
// long an individual request (or its retry) takes.
// ---------------------------------------------------------------------------

let requestQueue: Promise<void> = Promise.resolve();
let lastRequestStartMs: number | null = null;

/**
 * Slot-claimer seam.
 *
 * A `SlotClaimer` is awaited once before *every* CF fetch attempt (initial and
 * each retry), while the caller already holds the serialized queue slot. It
 * resolves when the caller may issue one CF request *now*, or rejects (e.g. with
 * an `AbortError`) if `opts.signal` aborts while it is pacing.
 *
 * Contract:
 *  - The default claimer (`defaultSlotClaimer`) enforces the local
 *    `MIN_REQUEST_SPACING_MS` spacing and stamps `lastRequestStartMs`. This is
 *    exactly today's behavior and depends on nothing external.
 *  - A custom claimer installed via `setSlotClaimer` fully owns pacing; when one
 *    is installed the local spacing wait is skipped (no double waiting).
 *  - A custom claimer may decline — e.g. a future DB-backed claimer that finds
 *    its backing store unavailable — by resolving with `{ fallback: true }`. In
 *    that case cfFetch falls back to the local `MIN_REQUEST_SPACING_MS` spacing
 *    for that attempt. Resolving with `void`/`undefined` (or `{ fallback:
 *    false }`) means the claimer handled pacing and local spacing is skipped.
 */
export interface SlotClaimResult {
  /** When true, the claimer declined; cfFetch should fall back to local spacing. */
  fallback?: boolean;
}

export type SlotClaimer = (opts: {
  signal?: AbortSignal;
}) => Promise<SlotClaimResult | void>;

let customSlotClaimer: SlotClaimer | null = null;

/** Install a custom slot claimer (e.g. a DB-backed one). See `SlotClaimer`. */
export function setSlotClaimer(fn: SlotClaimer): void {
  customSlotClaimer = fn;
}

/** Restore the default local-spacing slot claimer. */
export function resetSlotClaimer(): void {
  customSlotClaimer = null;
}

/** The default claimer: local `MIN_REQUEST_SPACING_MS` spacing, abort-aware. */
async function defaultSlotClaimer(signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (lastRequestStartMs !== null) {
    const elapsed = Date.now() - lastRequestStartMs;
    const remaining = MIN_REQUEST_SPACING_MS - elapsed;
    if (remaining > 0) {
      await sleep(remaining, signal);
    }
  }
  throwIfAborted(signal);
  lastRequestStartMs = Date.now();
}

/** Claim one CF request slot for a single attempt (custom claimer or default). */
async function claimSlot(options: CfFetchOptions): Promise<void> {
  if (customSlotClaimer) {
    const result = await customSlotClaimer({ signal: options.signal });
    if (!result?.fallback) {
      return;
    }
    // The custom claimer declined; fall through to local spacing.
  }
  await defaultSlotClaimer(options.signal);
}

function enqueue<T>(task: () => Promise<T>, options: CfFetchOptions = {}): Promise<T> {
  const scheduled = requestQueue.then(async () => {
    throwIfAborted(options.signal);
    return task();
  });

  // Keep the queue alive even if this task rejects; swallow here, the real
  // rejection is still delivered to the caller via `scheduled`.
  requestQueue = scheduled.then(
    () => undefined,
    () => undefined,
  );

  return scheduled;
}

function buildUrl(method: string, params: Record<string, string>): string {
  const url = new URL(`${CF_API_BASE}/${method}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/**
 * Parse a `Retry-After` header into milliseconds.
 * Supports the two RFC 7231 forms: a non-negative integer number of seconds, or
 * an HTTP-date. Returns `undefined` when the header is absent or unparseable; a
 * past HTTP-date clamps to `0`.
 */
export function parseRetryAfterMs(header: string | null): number | undefined {
  if (header === null) return undefined;
  const trimmed = header.trim();
  if (trimmed === "") return undefined;
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(0, dateMs - Date.now());
}

function envelopeFrom<T>(envelope: CfEnvelope<T>): T {
  if (envelope.status === "FAILED") {
    throw new CfApiError(envelope.comment);
  }
  return envelope.result;
}

async function requestOnce<T>(
  method: string,
  params: Record<string, string>,
  options: CfFetchOptions = {},
): Promise<T> {
  const response = await fetch(buildUrl(method, params), { signal: options.signal });

  // Check the HTTP status BEFORE reading the body: a 429/503 is often an HTML
  // page that would otherwise blow up `response.json()`.
  if (response.status === 429 || response.status === 503) {
    throw new CfRateLimitError(
      response.status,
      parseRetryAfterMs(response.headers.get("retry-after")),
    );
  }

  if (!response.ok) {
    // CF occasionally returns a FAILED *envelope* with a non-200 status; still
    // honor it. Anything else non-OK is a plain HTTP error (non-retryable).
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return envelopeFrom((await response.json()) as CfEnvelope<T>);
    }
    throw new CfHttpError(response.status);
  }

  // OK: parse the envelope. Invalid JSON here propagates as-is (non-retryable).
  return envelopeFrom((await response.json()) as CfEnvelope<T>);
}

function isRateLimitComment(error: unknown): boolean {
  return error instanceof CfApiError && error.message.toLowerCase().includes("limit exceeded");
}

function isRetryable(error: unknown): boolean {
  return error instanceof CfRateLimitError || isRateLimitComment(error);
}

/**
 * Pure backoff computation for retry index `attempt` (0-based: the first retry
 * uses `attempt = 0`).
 *
 * `max(retryAfterMs ?? 0, min(5000 * 2**attempt, 30000)) + random() * 1000`
 *
 * i.e. exponential backoff capped at 30s, but never shorter than a server-sent
 * `Retry-After`, plus up to 1s of jitter. `random` is injectable for tests.
 */
export function computeRetryDelayMs(
  attempt: number,
  retryAfterMs: number | undefined,
  random: () => number = Math.random,
): number {
  const backoff = Math.min(RETRY_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  return Math.max(retryAfterMs ?? 0, backoff) + random() * 1000;
}

/**
 * GET `https://codeforces.com/api/{method}`, courtesy rate-limited and retried
 * up to `MAX_CF_ATTEMPTS` times (with exponential backoff + jitter) when CF
 * reports its rate limit — either at the HTTP level (429/503, `CfRateLimitError`)
 * or via a FAILED envelope whose comment contains "limit exceeded".
 */
export function cfFetch<T>(
  method: string,
  params: Record<string, string> = {},
  options: CfFetchOptions = {},
): Promise<T> {
  return enqueue(async () => {
    for (let attempt = 0; ; attempt++) {
      // Claim a slot before *every* attempt (initial and each retry).
      await claimSlot(options);
      try {
        return await requestOnce<T>(method, params, options);
      } catch (error) {
        const isLastAttempt = attempt >= MAX_CF_ATTEMPTS - 1;
        if (!isRetryable(error) || isLastAttempt) {
          throw error;
        }
        const retryAfterMs =
          error instanceof CfRateLimitError ? error.retryAfterMs : undefined;
        await sleep(computeRetryDelayMs(attempt, retryAfterMs), options.signal);
      }
    }
  }, options);
}

// ---------------------------------------------------------------------------
// Typed wrappers
// ---------------------------------------------------------------------------

export interface CfUserInfo {
  handle: string;
  rating?: number;
  maxRating?: number;
  rank?: string;
  maxRank?: string;
}

export interface CfProblemsetResult {
  problems: CfProblem[];
}

/**
 * Minimal shape we consume from CF `contest.list`. Kept local to this module
 * (not in `src/lib/types.ts`) since it's only used for contest-date stamping.
 * `startTimeSeconds` is absent for contests that haven't started yet (e.g.
 * scheduled future contests).
 */
export interface CfContest {
  id: number;
  name: string;
  phase: string;
  startTimeSeconds?: number;
}

export function getUserInfo(handle: string): Promise<CfUserInfo[]> {
  return cfFetch<CfUserInfo[]>("user.info", { handles: handle });
}

export function getUserStatus(
  handle: string,
  from?: number,
  count?: number,
  options: CfFetchOptions = {},
): Promise<CfSubmission[]> {
  const params: Record<string, string> = { handle };
  if (from !== undefined) {
    params.from = String(from);
  }
  if (count !== undefined) {
    params.count = String(count);
  }
  return cfFetch<CfSubmission[]>("user.status", params, options);
}

export function getProblemset(): Promise<CfProblemsetResult> {
  return cfFetch<CfProblemsetResult>("problemset.problems");
}

/** CF `contest.list` (gym contests excluded) — used to derive contest start dates. */
export function getContestList(): Promise<CfContest[]> {
  return cfFetch<CfContest[]>("contest.list", { gym: "false" });
}

export interface CfRatingChange {
  contestId: number;
  contestName: string;
  newRating: number;
}

/** CF `user.rating` — one entry per rated contest the handle has participated in. */
export function getUserRating(
  handle: string,
  options: CfFetchOptions = {},
): Promise<CfRatingChange[]> {
  return cfFetch<CfRatingChange[]>("user.rating", { handle }, options);
}
