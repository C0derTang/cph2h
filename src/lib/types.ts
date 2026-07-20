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
export const POLL_MIN_INTERVAL_SEC = 5;
export const CLIENT_POLL_INTERVAL_MS = 6000;
export const QUEUE_POLL_INTERVAL_MS = 3000;
export const RUN_RATE_LIMIT_SEC = 5;
export const PROVISIONAL_RACES = 10;
export const ELO_K_PROVISIONAL = 64;
export const ELO_K_STANDARD = 32;
export const ELO_FLOOR = 100;
export const ELO_DEFAULT = 1200;

/** Hard bounds for the challenge-creation rating filter (CF problem ratings). */
export const PROBLEM_RATING_FLOOR = 800;
export const PROBLEM_RATING_CEIL = 3500;

/**
 * How stale a user's imported CF solve history may be before the ready path
 * triggers an incremental re-import (seconds). 6 hours.
 */
export const SOLVE_HISTORY_STALE_SEC = 21600;

/**
 * Retry delays for the client-side unlock refetch: fired at `startedAt`, then
 * backed off until the snapshot carries the statement.
 */
export const UNLOCK_REFETCH_BACKOFF_MS = [500, 1000, 2000] as const;

/**
 * How long a player may be absent (no poll heartbeat) during an active race
 * before the present opponent wins by forfeit. Generous enough to survive a
 * refresh or a network blip; a closed tab stays absent and forfeits.
 */
export const ABSENCE_FORFEIT_SEC = 60;

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

/**
 * Challenger-chosen constraints on problem selection (direct-challenge flow
 * only). All fields nullable — null means "no constraint". Rating bounds are
 * multiples of 100 within [PROBLEM_RATING_FLOOR, PROBLEM_RATING_CEIL]; dates
 * are ISO strings filtering on the problem's contest start date.
 */
export interface RaceProblemFilters {
  ratingMin: number | null;
  ratingMax: number | null;
  dateFrom: string | null;
  dateTo: string | null;
}

/**
 * Why problem selection failed at both-ready:
 * - `no_problems_in_filters` — no catalogued problem matches the filters.
 * - `all_problems_seen` — matching problems exist but every one has been
 *   attempted by at least one player.
 */
export type ProblemSelectionFailureReason =
  | "no_problems_in_filters"
  | "all_problems_seen";

/**
 * Result contract for the `selectRaceProblem` hook. On failure the ready
 * route must NOT transition the race to active; it resets ready flags and
 * persists the reason for the snapshot.
 */
export type SelectProblemResult =
  | { ok: true; problemId: ProblemId }
  | { ok: false; reason: ProblemSelectionFailureReason };

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
  /**
   * Server clock (ISO) at snapshot-build time. Clients compute
   * `skewMs = localReceiveTime - Date.parse(now)` and use skew-corrected time
   * for countdowns and the unlock refetch timer — never raw `Date.now()`.
   */
  now: string;
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
  /**
   * Per-player presence heartbeats (ISO), stamped by each client's polls
   * while active. Clients render the absence-forfeit countdown from the
   * opponent's stamp using skew-corrected time. Null before a first poll.
   */
  p1LastSeenAt: string | null;
  p2LastSeenAt: string | null;
  /** Challenger-chosen problem filters; null when the race has none. */
  filters: RaceProblemFilters | null;
  /**
   * Set when the last both-ready attempt could not select a problem (race
   * stays in the lobby with ready flags reset). Null otherwise.
   */
  problemSelectionFailedReason: ProblemSelectionFailureReason | null;
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
  | { type: "draw_declined"; byUserId: string }
  | { type: "problem_selection_failed"; reason: ProblemSelectionFailureReason }
  | { type: "filters_updated" };

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

/** Live activity counters for the queue page (GET /api/presence). `queued` =
 *  distinct users freshly in the matchmaking queue; `playing` = distinct
 *  active-race participants. */
export interface PresenceCounts {
  queued: number;
  playing: number;
}

/** How often the queue page refreshes the queued/playing counters. */
export const PRESENCE_POLL_INTERVAL_MS = 8000;

export interface CreateRaceResponse {
  raceId: string;
  challengeToken: string;
  joinUrl: string;
}

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
 * submit a COMPILATION_ERROR to `problemUrl` within the window, which the check
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
// Reports + admin dashboard
// ---------------------------------------------------------------------------

export const REPORT_REASONS = ["cheating", "av_violation", "abusive", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export type ReportStatus = "open" | "resolved";

export interface CreateReportRequest {
  raceId: string;
  reason: ReportReason;
  note?: string;
}

export interface ReportDTO {
  id: string;
  raceId: string;
  reason: ReportReason;
  note: string | null;
  status: ReportStatus;
  createdAt: string; // ISO
  resolvedAt: string | null; // ISO
  reporter: PublicUser;
  reported: PublicUser;
}

export interface ReportSubmissionEvidence {
  userId: string;
  verdict: string | null;
  submittedAt: string; // ISO
}

/**
 * Race row fields surfaced in report evidence (issue #192) so admins can see
 * how long the race lasted alongside the submission timeline.
 */
export interface ReportRaceEvidence {
  status: RaceStatus;
  startedAt: string | null; // ISO
  finishedAt: string | null; // ISO
  timeLimitSec: number;
}

/** Aggregate stats for the admin dashboard (GET /api/admin/overview). */
export interface AdminOverview {
  totalUsers: number;
  totalRaces: number;
  races7d: number;
  openReports: number;
  /** Last 30 days, one entry per day, ISO date (`YYYY-MM-DD`). */
  racesPerDay: { date: string; count: number }[];
  /** Verdict distribution from `race_submissions`. */
  verdictDist: { verdict: string; count: number }[];
  /** Elo distribution bucketed into 100-wide buckets. */
  eloHistogram: { bucketFloor: number; count: number }[];
}

// ---------------------------------------------------------------------------
// Launch Tournament bracket (issue #235 — schema/contract only, no engine yet)
//
// Single-tournament assumption: exactly one bracket exists at a time. Re-seed
// wipes and regenerates `tournament_matches` rather than versioning brackets.
// ---------------------------------------------------------------------------

export const TOURNAMENT_BRACKET_SIZE = 64;
export const TOURNAMENT_TOTAL_ROUNDS = 6;
export const TOURNAMENT_MATCH_WINDOW_HOURS = 24;

export type TournamentMatchStatus = "pending" | "done";
export type TournamentMatchResolution = "race" | "walkover" | "bye";

export interface TournamentMatchPlayer {
  userId: string;
  username: string;
  cfHandle: string | null;
  cfRating: number | null;
  seed: number;
}

export interface TournamentMatchDTO {
  id: string;
  round: number;
  slot: number;
  p1: TournamentMatchPlayer | null;
  p2: TournamentMatchPlayer | null;
  raceId: string | null;
  raceStatus: RaceStatus | null; // joined; null when no race
  raceOutcome: RaceOutcome | null; // joined; null when no race
  winnerId: string | null;
  status: TournamentMatchStatus;
  resolution: TournamentMatchResolution | null;
  deadlineAt: string | null; // ISO
}

export interface TournamentBracketDTO {
  seeded: boolean;
  matches: TournamentMatchDTO[];
}

export interface SeedBracketResponse {
  created: number;
  byes: number;
}

export interface CreateRoundRacesResponse {
  created: number;
  skipped: number;
}

export interface ResolveRoundResponse {
  resolved: number;
  advanced: number;
  pendingRaces: number;
  needsAttention: string[]; // match ids whose race ended draw/aborted
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
