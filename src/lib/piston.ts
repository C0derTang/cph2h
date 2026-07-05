/**
 * Piston client (issue #46, replaces Judge0/#13).
 *
 * Thin wrapper around the free, keyless public Piston API
 * (https://github.com/engineer-man/piston) — used to run a candidate's C++
 * against a race problem's cached sample tests (`problem_statements`, #9) so
 * they get fast pass/fail feedback without spending a real Codeforces
 * submission (#11 owns the authoritative CF verdict).
 *
 * Judge0 CE required a paid RapidAPI key and self-hosting needs a privileged
 * Docker VM (won't run on Vercel). Piston has no API key and no infra to
 * manage, at the cost of a public rate limit (~5 req/s) and no control over
 * uptime — acceptable for this best-effort, non-authoritative endpoint.
 *
 * Unlike Judge0, Piston exchanges plain UTF-8 text (no base64 encoding).
 */

const PISTON_URL = process.env.PISTON_URL ?? "https://emkc.org/api/v2/piston";

/**
 * Pinned C++ (GCC) runtime version. Verified against `GET /runtimes` on the
 * public Piston instance (emkc.org) — language "c++" (aliases "cpp", "g++")
 * currently reports version "10.2.0". Piston's `version` field is a SemVer
 * *selector*, not necessarily an exact match requirement, but pinning here
 * keeps behavior deterministic; override with `PISTON_URL` pointing at a
 * self-hosted instance if a different version is needed.
 */
const PISTON_CPP_VERSION = "10.2.0";

// ---------------------------------------------------------------------------
// Status constants
// ---------------------------------------------------------------------------

export const PISTON_STATUS_ACCEPTED = 0;
export const PISTON_STATUS_COMPILE_ERROR = 1;
export const PISTON_STATUS_RUNTIME_ERROR = 2;

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

export interface PistonResult {
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

interface PistonStage {
  stdout: string;
  stderr: string;
  output: string;
  code: number | null;
  signal: string | null;
}

interface PistonExecuteResponse {
  language: string;
  version: string;
  run: PistonStage;
  compile?: PistonStage;
}

/**
 * Submit `code` to Piston with `stdin` and return the result. Throws on a
 * network failure or non-2xx HTTP response — callers (the run route) catch
 * this and surface a `judge0_error` {@link RunResponse} (name kept from #13
 * to avoid touching the shared `RunResponse` union in `types.ts`).
 */
export async function runCode({ code, stdin }: RunCodeInput): Promise<PistonResult> {
  const res = await fetch(`${PISTON_URL}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      language: "c++",
      version: PISTON_CPP_VERSION,
      files: [{ content: code }],
      stdin,
    }),
  });

  if (!res.ok) {
    throw new Error(`Piston request failed: HTTP ${res.status}`);
  }

  const data = (await res.json()) as PistonExecuteResponse;

  if (data.compile && data.compile.code !== 0) {
    return {
      statusId: PISTON_STATUS_COMPILE_ERROR,
      status: "Compilation Error",
      stdout: "",
      stderr: data.compile.stderr,
      compileOutput: data.compile.stderr || data.compile.output || null,
      timeSec: null,
    };
  }

  const { run } = data;
  if (run.code !== 0 || run.signal) {
    return {
      statusId: PISTON_STATUS_RUNTIME_ERROR,
      status: run.signal ? `Runtime Error (${run.signal})` : `Runtime Error (exit code ${run.code})`,
      stdout: run.stdout,
      stderr: run.stderr,
      compileOutput: null,
      timeSec: null,
    };
  }

  return {
    statusId: PISTON_STATUS_ACCEPTED,
    status: "Accepted",
    stdout: run.stdout,
    stderr: run.stderr,
    compileOutput: null,
    timeSec: null,
  };
}
