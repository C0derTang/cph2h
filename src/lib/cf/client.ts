/**
 * Typed Codeforces public-API client.
 *
 * Wraps the unauthenticated `https://codeforces.com/api/*` endpoints with:
 *  - Envelope parsing (`{status, result}` / `{status, comment}`) and a typed
 *    `CfApiError` on `status: "FAILED"`.
 *  - Courtesy rate limiting: a module-level promise chain that guarantees at
 *    least `MIN_REQUEST_SPACING_MS` between request *starts* (CF's public API
 *    allows ~1 request / 2s). Queued requests can be aborted before they spend
 *    a CF request slot.
 *  - A single retry with a fixed backoff when CF reports its own rate limit
 *    has been exceeded (`comment` contains "limit exceeded").
 */

import type { CfProblem, CfSubmission } from "@/lib/types";

const CF_API_BASE = "https://codeforces.com/api";

/** Minimum spacing (ms) enforced between the *start* of successive requests. */
export const MIN_REQUEST_SPACING_MS = 2000;

/** Backoff (ms) before the single retry when CF itself reports rate limiting. */
export const RETRY_BACKOFF_MS = 5000;

export class CfApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CfApiError";
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
// previous one settles, and — before doing its own work — waits out whatever
// remains of the `MIN_REQUEST_SPACING_MS` window since the last request
// *started*. This serializes all cfFetch calls and guarantees the spacing
// regardless of how long an individual request (or its retry) takes.
// ---------------------------------------------------------------------------

let requestQueue: Promise<void> = Promise.resolve();
let lastRequestStartMs: number | null = null;

function enqueue<T>(task: () => Promise<T>, options: CfFetchOptions = {}): Promise<T> {
  const scheduled = requestQueue.then(async () => {
    throwIfAborted(options.signal);
    if (lastRequestStartMs !== null) {
      const elapsed = Date.now() - lastRequestStartMs;
      const remaining = MIN_REQUEST_SPACING_MS - elapsed;
      if (remaining > 0) {
        await sleep(remaining, options.signal);
      }
    }
    throwIfAborted(options.signal);
    lastRequestStartMs = Date.now();
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

async function requestOnce<T>(
  method: string,
  params: Record<string, string>,
  options: CfFetchOptions = {},
): Promise<T> {
  const response = await fetch(buildUrl(method, params), { signal: options.signal });
  const envelope = (await response.json()) as CfEnvelope<T>;
  if (envelope.status === "FAILED") {
    throw new CfApiError(envelope.comment);
  }
  return envelope.result;
}

function isRateLimitComment(error: unknown): boolean {
  return error instanceof CfApiError && error.message.toLowerCase().includes("limit exceeded");
}

/**
 * GET `https://codeforces.com/api/{method}`, courtesy rate-limited and
 * retried once (after a fixed backoff) if CF itself reports its rate limit
 * was exceeded.
 */
export function cfFetch<T>(
  method: string,
  params: Record<string, string> = {},
  options: CfFetchOptions = {},
): Promise<T> {
  return enqueue(async () => {
    try {
      return await requestOnce<T>(method, params, options);
    } catch (error) {
      if (!isRateLimitComment(error)) {
        throw error;
      }
      await sleep(RETRY_BACKOFF_MS, options.signal);
      return requestOnce<T>(method, params, options);
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
