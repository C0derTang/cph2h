/**
 * Codeforces solution-submit layer (issue #11).
 *
 * TS port of the submit flow of https://github.com/xalanq/cf-tool: refresh the
 * authenticated session, GET the problem's submit page for a fresh CSRF token,
 * POST the submit form (with the same `ftaa`/`bfaa` fingerprint fields the
 * login flow sends), detect the form-level errors CF renders inline, and read
 * the resulting submission id back off the public `user.status` API.
 *
 * REUSE: the authenticated session (cookie jar + CSRF) comes from
 * `ensureSession` (#5); the submission id is read back with `getUserStatus`
 * (#3). This module never re-implements login and never touches the DB — it is
 * unit-testable against recorded HTML fixtures with `ensureSession` /
 * `getUserStatus` / `fetch` mocked.
 *
 * SECURITY: the user's source code is treated as sensitive — it is only ever
 * placed in the outgoing request body and is never logged.
 */

import {
  ensureSession,
  extractCsrfToken,
  extractLoggedInHandle,
  generateFtaa,
  mergeSetCookies,
  serializeCookies,
  type CookieJar,
} from "@/lib/cf/auth";
import { getUserStatus } from "@/lib/cf/client";
import { CF_LANGUAGE_ID, problemIdOf, type ProblemId } from "@/lib/types";

const CF_BASE = "https://codeforces.com";

/** Fixed browser-fingerprint value cf-tool sends as `bfaa` (mirrors login). */
const BFAA = "f1b3f18c715565b589b7823cda7448ce";

/** Substring CF renders when the identical source was already submitted. */
const DUPLICATE_MARKER = "You have submitted exactly the same code before";

/** How many recent submissions to scan when reading the id back. */
const READBACK_COUNT = 10;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type CfSubmitErrorCode =
  | "not_logged_in"
  | "duplicate_code"
  | "submit_page_unavailable"
  | "submit_rejected"
  | "submission_not_found";

export class CfSubmitError extends Error {
  readonly code: CfSubmitErrorCode;
  constructor(code: CfSubmitErrorCode, message: string) {
    super(message);
    this.name = "CfSubmitError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/** URL of the submit page / POST target for a contest problem. */
export function submitUrl(contestId: number): string {
  return `${CF_BASE}/contest/${contestId}/submit`;
}

export interface SubmitFormInput {
  csrfToken: string;
  index: string;
  languageId: number;
  code: string;
  ftaa: string;
}

/**
 * Build the `application/x-www-form-urlencoded` body for a submit POST,
 * matching cf-tool's field set. `bfaa` is the fixed fingerprint; `sourceFile`
 * is intentionally empty (source is inlined via `source`).
 */
export function buildSubmitForm(input: SubmitFormInput): URLSearchParams {
  return new URLSearchParams({
    csrf_token: input.csrfToken,
    ftaa: input.ftaa,
    bfaa: BFAA,
    action: "submitSolutionFormSubmitted",
    submittedProblemIndex: input.index,
    programTypeId: String(input.languageId),
    source: input.code,
    tabSize: "4",
    sourceFile: "",
  });
}

/**
 * Inspect a POST response body for CF's inline form errors. Returns a typed
 * error when the submit was rejected, or `null` when the body carries no known
 * error (i.e. the submit was accepted and CF redirected / re-rendered clean).
 */
export function extractSubmitError(html: string): CfSubmitError | null {
  if (html.includes(DUPLICATE_MARKER)) {
    return new CfSubmitError(
      "duplicate_code",
      "You have already submitted exactly this code to Codeforces.",
    );
  }
  // CF renders rejected-form messages in `<span class="error ...">…</span>`.
  const match = /<span[^>]*class=['"][^'"]*\berror\b[^'"]*['"][^>]*>([^<]+)<\/span>/i.exec(
    html,
  );
  if (match) {
    const text = match[1].trim();
    if (text) {
      return new CfSubmitError("submit_rejected", text);
    }
  }
  return null;
}

/**
 * From a `user.status` listing, pick the id of the most recent submission to
 * `problemId` (latest `creationTimeSeconds`, ties broken by highest id — the
 * one just made). Returns `null` when none match.
 */
export function findLatestSubmissionId(
  submissions: { id: number; creationTimeSeconds: number; problem: { contestId: number; index: string } }[],
  problemId: ProblemId,
): number | null {
  let best: { id: number; creationTimeSeconds: number } | null = null;
  for (const s of submissions) {
    if (problemIdOf(s.problem) !== problemId) continue;
    if (
      best === null ||
      s.creationTimeSeconds > best.creationTimeSeconds ||
      (s.creationTimeSeconds === best.creationTimeSeconds && s.id > best.id)
    ) {
      best = { id: s.id, creationTimeSeconds: s.creationTimeSeconds };
    }
  }
  return best ? best.id : null;
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

export interface SubmitSolutionInput {
  userId: string;
  contestId: number;
  index: string;
  code: string;
  /** CF programming-language id; defaults to {@link CF_LANGUAGE_ID} (54). */
  languageId?: number;
}

export interface SubmitSolutionResult {
  cfSubmissionId: number;
}

/**
 * Submit `code` to `contestId/index` on Codeforces as the linked user and
 * return the resulting submission id.
 *
 * @throws {CfSubmitError} on any submit-specific failure (not logged in,
 *   duplicate code, page unavailable, form rejection, or the id not appearing
 *   in the user's recent submissions). Errors from {@link ensureSession}
 *   (`CfAuthError`) and {@link getUserStatus} (`CfApiError`) propagate as-is so
 *   the route can fold them all into a single manual-fallback response.
 */
export async function submitSolution(
  input: SubmitSolutionInput,
): Promise<SubmitSolutionResult> {
  const { userId, contestId, index, code } = input;
  const languageId = input.languageId ?? CF_LANGUAGE_ID;
  const problemId = problemIdOf({ contestId, index });

  // 1. Live authenticated session (cookies + csrf) — never re-implement login.
  const session = await ensureSession(userId);
  const jar: CookieJar = { ...session.cookieJar };

  // 2. GET the submit page to confirm we are logged in and refresh the CSRF.
  const pageUrl = submitUrl(contestId);
  const pageResponse = await fetch(pageUrl, {
    redirect: "follow",
    headers: { cookie: serializeCookies(jar) },
  });
  mergeSetCookies(jar, pageResponse);
  const pageHtml = await pageResponse.text();

  const handle = extractLoggedInHandle(pageHtml);
  if (!handle) {
    throw new CfSubmitError(
      "not_logged_in",
      "The Codeforces session is not signed in. Submit manually and we will pick up the verdict.",
    );
  }

  const csrfToken = extractCsrfToken(pageHtml) ?? session.csrfToken;
  if (!csrfToken) {
    throw new CfSubmitError(
      "submit_page_unavailable",
      "Could not read the Codeforces submit page. Try again shortly.",
    );
  }

  // 3. POST the submit form. csrf goes in both the query and the body, as
  //    cf-tool does; redirect is manual so a success 3xx yields an empty body.
  const form = buildSubmitForm({
    csrfToken,
    index,
    languageId,
    code,
    ftaa: generateFtaa(),
  });
  const postUrl = `${pageUrl}?csrf_token=${encodeURIComponent(csrfToken)}`;
  const postResponse = await fetch(postUrl, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: serializeCookies(jar),
    },
    body: form.toString(),
  });
  mergeSetCookies(jar, postResponse);

  // 4. Detect inline form errors (duplicate / rejection). On success CF
  //    redirects with an empty body, so there is nothing to match.
  const postBody = await postResponse.text().catch(() => "");
  const submitError = extractSubmitError(postBody);
  if (submitError) throw submitError;

  // 5. Read the submission id back off the public API.
  const submissions = await getUserStatus(handle, 1, READBACK_COUNT);
  const cfSubmissionId = findLatestSubmissionId(submissions, problemId);
  if (cfSubmissionId === null) {
    throw new CfSubmitError(
      "submission_not_found",
      "Submitted, but the submission id could not be confirmed yet.",
    );
  }

  return { cfSubmissionId };
}
