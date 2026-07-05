/**
 * Shared contracts for cph2h.
 *
 * This file is the single source of truth for cross-module types.
 * All features (race engine, matchmaking, IDE, LiveKit events, CF
 * integration) code against these shapes. Change with care — every
 * wave of work depends on it.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_TIME_LIMIT_SEC = 2400; // 40 minutes
export const COUNTDOWN_SEC = 10;
export const LIVEKIT_DATA_TOPIC = "race";
export const CF_LANGUAGE_ID = 54; // GNU G++17 7.3.0 on Codeforces
export const JUDGE0_CPP_LANGUAGE_ID = 54; // C++ (GCC 9.2.0) on Judge0 CE
export const POLL_MIN_INTERVAL_SEC = 5;
export const CLIENT_POLL_INTERVAL_MS = 6000;
export const QUEUE_POLL_INTERVAL_MS = 3000;
export const RUN_RATE_LIMIT_SEC = 5;
export const PROVISIONAL_RACES = 10;
export const ELO_K_PROVISIONAL = 64;
export const ELO_K_STANDARD = 32;
export const ELO_FLOOR = 100;
export const ELO_DEFAULT = 1200;

export const DEFAULT_CPP_TEMPLATE = `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);

}
`;

// ---------------------------------------------------------------------------
// Race lifecycle
// ---------------------------------------------------------------------------

export type RaceStatus = "pending" | "ready" | "active" | "finished" | "aborted";

export type RaceOutcome = "p1_win" | "p2_win" | "draw" | "aborted";

/** Problem identity: `${contestId}${index}`, e.g. "1794C". */
export type ProblemId = string;

export interface ProblemRef {
  id: ProblemId;
  contestId: number;
  index: string;
  name: string;
  rating: number;
  /** Absolute URL to the problem on codeforces.com. */
  url: string;
}

export interface SampleTest {
  input: string;
  output: string;
}

export interface ProblemStatement {
  problemId: ProblemId;
  /**
   * Sanitized statement HTML with math pre-rendered to KaTeX markup
   * server-side (CF `$$$...$$$` delimiters are replaced, not preserved).
   * Safe to inject; re-sanitized client-side as defense in depth.
   */
  html: string;
  samples: SampleTest[];
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/** User shape safe to send to any client. */
export interface PublicUser {
  id: string;
  username: string;
  cfHandle: string | null;
  cfRating: number | null;
  elo: number;
  racesPlayed: number;
}

// ---------------------------------------------------------------------------
// Race snapshot (GET /api/races/[id]) — the source of truth for clients
// ---------------------------------------------------------------------------

export interface RaceSubmissionInfo {
  userId: string;
  cfSubmissionId: number | null;
  verdict: string | null; // CF verdict string, e.g. "OK", "WRONG_ANSWER", null = pending
  submittedAt: string; // ISO
}

export interface RaceSnapshot {
  id: string;
  status: RaceStatus;
  p1: PublicUser;
  p2: PublicUser | null;
  p1Ready: boolean;
  p2Ready: boolean;
  timeLimitSec: number;
  /** ISO; may be in the future (client-side countdown derives from this). */
  startedAt: string | null;
  endsAt: string | null;
  finishedAt: string | null;
  outcome: RaceOutcome | null;
  winnerId: string | null;
  eloDeltaP1: number | null;
  eloDeltaP2: number | null;
  /** Only present once the race has started (now >= startedAt). */
  problem: ProblemRef | null;
  /** Only present once the race has started. */
  statement: ProblemStatement | null;
  submissions: RaceSubmissionInfo[];
  livekitRoom: string;
  challengeToken: string | null;
  /**
   * User id of the player with an outstanding draw offer, or null. A draw
   * requires mutual consent: one player offers, the opponent accepts. Cleared
   * on decline, withdraw, or when the race ends.
   */
  drawOfferBy: string | null;
}

// ---------------------------------------------------------------------------
// LiveKit data-channel events (server -> clients, topic "race")
// Events are HINTS. Clients refetch the snapshot on mount, reconnect, or any
// event they cannot apply cleanly.
// ---------------------------------------------------------------------------

export type RaceEvent =
  | { type: "opponent_joined"; user: PublicUser }
  | { type: "ready_state"; p1Ready: boolean; p2Ready: boolean }
  | { type: "countdown"; startsAt: string; endsAt: string }
  | { type: "race_start"; problem: ProblemRef; endsAt: string }
  | {
      type: "verdict";
      userId: string;
      verdict: string;
      cfSubmissionId: number;
      submittedAt: string;
    }
  | {
      type: "race_finished";
      outcome: RaceOutcome;
      winnerId: string | null;
      eloDeltas: Record<string, number>;
    }
  | { type: "aborted"; byUserId: string }
  | { type: "draw_offered"; byUserId: string }
  | { type: "draw_declined"; byUserId: string };

export function encodeRaceEvent(event: RaceEvent): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(event));
}

export function decodeRaceEvent(data: Uint8Array): RaceEvent | null {
  try {
    return JSON.parse(new TextDecoder().decode(data)) as RaceEvent;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Route responses
// ---------------------------------------------------------------------------

export interface QueueStatusResponse {
  state: "queued" | "matched" | "idle";
  raceId: string | null;
  waitedSec: number | null;
  currentBand: number | null;
}

export interface CreateRaceResponse {
  raceId: string;
  challengeToken: string;
  joinUrl: string;
}

export type SubmitResponse =
  | { ok: true; cfSubmissionId: number }
  | {
      ok: false;
      /** Structured failure — client shows manual-submit fallback on cf_error. */
      error: "cf_error" | "not_active" | "rate_limited" | "not_participant";
      message: string;
    };

export interface RunSampleResult {
  sampleIndex: number;
  passed: boolean;
  actualOutput: string;
  stderr: string;
  status: string; // Judge0 status description, e.g. "Accepted", "Compilation Error"
  compileOutput: string | null;
  timeSec: number | null;
}

export type RunResponse =
  | { ok: true; results: RunSampleResult[] }
  | { ok: false; error: "rate_limited" | "no_samples" | "judge0_error"; message: string };

export interface CfLinkResponse {
  ok: boolean;
  cfHandle?: string;
  cfRating?: number | null;
  error?: string;
}

/**
 * Start of the compile-error handle-ownership challenge. The user is asked to
 * submit a COMPILE_ERROR to `problemUrl` within the window, which the check
 * step confirms via the public API (Codeforces Cloudflare-blocks server-side
 * login, so no password is ever collected).
 */
export type CfVerifyStartResponse =
  | {
      ok: true;
      handle: string;
      problemId: ProblemId;
      problemName: string;
      problemUrl: string;
      expiresAt: string; // ISO
    }
  | { ok: false; error: string };

export interface LeaderboardEntry {
  rank: number;
  user: PublicUser;
}

// ---------------------------------------------------------------------------
// Codeforces API shapes (subset we consume)
// ---------------------------------------------------------------------------

export interface CfSubmission {
  id: number;
  contestId: number;
  creationTimeSeconds: number;
  problem: { contestId: number; index: string; name: string; rating?: number };
  author: { members: { handle: string }[] };
  programmingLanguage: string;
  verdict?: string; // absent while testing
}

export interface CfProblem {
  contestId: number;
  index: string;
  name: string;
  rating?: number;
  tags: string[];
}

export function problemIdOf(p: { contestId: number; index: string }): ProblemId {
  return `${p.contestId}${p.index}`;
}

export function problemUrl(p: { contestId: number; index: string }): string {
  return `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`;
}
