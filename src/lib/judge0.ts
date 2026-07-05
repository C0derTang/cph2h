/**
 * Judge0 CE client (issue #13).
 *
 * Thin wrapper around Judge0 CE's "submissions" endpoint via RapidAPI. Used
 * to run a candidate's C++ against a race problem's cached sample tests
 * (`problem_statements`, #9) so they get fast pass/fail feedback without
 * spending a real Codeforces submission (#11 owns the authoritative CF
 * verdict).
 *
 * `wait=true` is used for simplicity (per the issue spec): Judge0 CE's queue
 * is fast enough for this "run against a handful of samples" use case, so we
 * accept the synchronous request rather than polling a token.
 */

import { JUDGE0_CPP_LANGUAGE_ID } from "@/lib/types";

const JUDGE0_URL =
  "https://judge0-ce.p.rapidapi.com/submissions?base64_encoded=true&wait=true";
const JUDGE0_HOST = "judge0-ce.p.rapidapi.com";

// ---------------------------------------------------------------------------
// Base64 helpers
// ---------------------------------------------------------------------------

export function encodeBase64(text: string): string {
  return Buffer.from(text, "utf-8").toString("base64");
}

export function decodeBase64(text: string | null | undefined): string {
  if (!text) return "";
  return Buffer.from(text, "base64").toString("utf-8");
}

// ---------------------------------------------------------------------------
// Status map
// ---------------------------------------------------------------------------

/**
 * Judge0 status ids -> human-readable descriptions. Judge0 also returns its
 * own `description` string, which we prefer when present; this map is the
 * fallback (and documents the ids we branch on, e.g. 3 = Accepted,
 * 6 = Compilation Error).
 */
export const JUDGE0_STATUS_MAP: Record<number, string> = {
  1: "In Queue",
  2: "Processing",
  3: "Accepted",
  4: "Wrong Answer",
  5: "Time Limit Exceeded",
  6: "Compilation Error",
  7: "Runtime Error (SIGSEGV)",
  8: "Runtime Error (SIGXFSZ)",
  9: "Runtime Error (SIGFPE)",
  10: "Runtime Error (SIGABRT)",
  11: "Runtime Error (NZEC)",
  12: "Runtime Error (Other)",
  13: "Internal Error",
  14: "Exec Format Error",
};

export const JUDGE0_STATUS_ACCEPTED = 3;
export const JUDGE0_STATUS_COMPILE_ERROR = 6;

export function statusDescription(id: number, fallback?: string | null): string {
  return JUDGE0_STATUS_MAP[id] ?? fallback ?? `Unknown status (${id})`;
}

// ---------------------------------------------------------------------------
// Output comparison (pure — unit tested)
// ---------------------------------------------------------------------------

/**
 * Normalize a program's output the way competitive-programming checkers
 * typically do: CRLF -> LF, strip trailing whitespace on every line, and
 * drop trailing blank lines. Two outputs that differ only in trailing
 * whitespace should compare equal.
 */
export function normalizeOutput(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
}

/** True when `actual` matches `expected` under {@link normalizeOutput}. */
export function outputsMatch(actual: string, expected: string): boolean {
  return normalizeOutput(actual) === normalizeOutput(expected);
}

// ---------------------------------------------------------------------------
// runCode
// ---------------------------------------------------------------------------

export interface Judge0Result {
  statusId: number;
  status: string;
  stdout: string;
  stderr: string;
  compileOutput: string | null;
  timeSec: number | null;
}

interface RunCodeInput {
  code: string;
  stdin: string;
}

interface Judge0SubmissionResponse {
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  message: string | null;
  time: string | null;
  status: { id: number; description: string };
}

/**
 * Submit `code` to Judge0 CE with `stdin` and return the decoded result once
 * execution finishes. Throws on a missing API key, network failure, or
 * non-2xx HTTP response — callers (the run route) catch this and surface a
 * `judge0_error` {@link RunResponse}.
 */
export async function runCode({ code, stdin }: RunCodeInput): Promise<Judge0Result> {
  const apiKey = process.env.JUDGE0_API_KEY;
  if (!apiKey) {
    throw new Error("JUDGE0_API_KEY is not set");
  }

  const res = await fetch(JUDGE0_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-RapidAPI-Key": apiKey,
      "X-RapidAPI-Host": JUDGE0_HOST,
    },
    body: JSON.stringify({
      language_id: JUDGE0_CPP_LANGUAGE_ID,
      source_code: encodeBase64(code),
      stdin: encodeBase64(stdin),
    }),
  });

  if (!res.ok) {
    throw new Error(`Judge0 request failed: HTTP ${res.status}`);
  }

  const data = (await res.json()) as Judge0SubmissionResponse;

  return {
    statusId: data.status.id,
    status: statusDescription(data.status.id, data.status.description),
    stdout: decodeBase64(data.stdout),
    stderr: decodeBase64(data.stderr),
    compileOutput: data.compile_output ? decodeBase64(data.compile_output) : null,
    timeSec: data.time ? Number(data.time) : null,
  };
}
