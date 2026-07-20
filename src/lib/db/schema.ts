/**
 * Drizzle schema for cph2h.
 *
 * Implemented in issue #1 (DB schema + migrations). Table shapes mirror the
 * project plan and the shared contracts in `src/lib/types.ts` — in
 * particular `RaceStatus`, `RaceOutcome`, and `DEFAULT_CPP_TEMPLATE`. Keep
 * this file and `src/lib/types.ts` in sync when either changes.
 */

import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { DEFAULT_CPP_TEMPLATE, type SampleTest } from "@/lib/types";

// ---------------------------------------------------------------------------
// Enums — values must match `RaceStatus` / `RaceOutcome` in src/lib/types.ts
// ---------------------------------------------------------------------------

export const raceStatusEnum = pgEnum("race_status", [
  "pending",
  "ready",
  "active",
  "finished",
  "aborted",
]);

export const raceOutcomeEnum = pgEnum("race_outcome", [
  "p1_win",
  "p2_win",
  "draw",
  "aborted",
]);

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkId: text("clerk_id").notNull().unique(),
  username: text("username").notNull(),
  cfHandle: text("cf_handle").unique(),
  cfRating: integer("cf_rating"),
  cfLinkedAt: timestamp("cf_linked_at", { withTimezone: true }),
  elo: integer("elo").notNull().default(1200),
  racesPlayed: integer("races_played").notNull().default(0),
  cppTemplate: text("cpp_template").notNull().default(DEFAULT_CPP_TEMPLATE),
  /**
   * Last time this user's CF solve history was imported into `user_problems`.
   * Null = never (full import pending). Drives incremental refresh at ready
   * time so problem exclusion stays fresh.
   */
  solveHistorySyncedAt: timestamp("solve_history_synced_at", {
    withTimezone: true,
  }),
  /**
   * 1-based Codeforces `user.status` offset for an unfinished incremental
   * import. Null means the next incremental refresh starts at the newest page.
   */
  solveHistoryImportCursor: integer("solve_history_import_cursor"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  isAdmin: boolean("is_admin").notNull().default(false),
});

// ---------------------------------------------------------------------------
// Codeforces account linking
//
// The old password-login flow (cf_credentials / cf_sessions, encrypted at rest)
// was removed in issue #55: Codeforces Cloudflare-blocks server-side login, so
// ownership is now proven with a compile-error submission confirmed via the
// public API (see handle_verifications below). Those two tables are dropped by
// migration 0003.
// ---------------------------------------------------------------------------

/**
 * Pending compile-error handle-ownership challenge. Codeforces Cloudflare-blocks
 * server-side login, so we verify ownership by asking the user to submit a
 * COMPILATION_ERROR to `problemId`, then confirm it via the public API. One pending
 * challenge per user (upserted on each start).
 */
export const handleVerifications = pgTable("handle_verifications", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  handle: text("handle").notNull(),
  problemId: text("problem_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// ---------------------------------------------------------------------------
// Problems
// ---------------------------------------------------------------------------

export const problems = pgTable(
  "problems",
  {
    /** e.g. "1794C" — see `problemIdOf` in src/lib/types.ts. */
    id: text("id").primaryKey(),
    contestId: integer("contest_id").notNull(),
    index: text("index").notNull(),
    name: text("name").notNull(),
    rating: integer("rating").notNull(),
    tags: jsonb("tags").notNull().$type<string[]>(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    /**
     * Contest start time from CF `contest.list`; null when unknown (e.g. gym).
     * Problems with a null date are excluded when a race has a date filter.
     */
    contestStartedAt: timestamp("contest_started_at", { withTimezone: true }),
  },
  (t) => [
    index("problems_rating_contest_started_at_idx").on(
      t.rating,
      t.contestStartedAt,
    ),
  ],
);

export const problemStatements = pgTable("problem_statements", {
  problemId: text("problem_id")
    .primaryKey()
    .references(() => problems.id),
  html: text("html").notNull(),
  samples: jsonb("samples").notNull().$type<SampleTest[]>(),
  scrapedAt: timestamp("scraped_at", { withTimezone: true }).notNull(),
});

export const userProblems = pgTable(
  "user_problems",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    problemId: text("problem_id")
      .notNull()
      .references(() => problems.id),
    solved: boolean("solved").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.problemId] }),
    index("user_problems_user_id_idx").on(t.userId),
  ],
);

// ---------------------------------------------------------------------------
// Races
// ---------------------------------------------------------------------------

export const races = pgTable(
  "races",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: raceStatusEnum("status").notNull().default("pending"),
    challengeToken: text("challenge_token").unique(),
    p1Id: uuid("p1_id")
      .notNull()
      .references(() => users.id),
    p2Id: uuid("p2_id").references(() => users.id),
    p1Ready: boolean("p1_ready").notNull().default(false),
    p2Ready: boolean("p2_ready").notNull().default(false),
    problemId: text("problem_id").references(() => problems.id),
    timeLimitSec: integer("time_limit_sec").notNull().default(2400),
    /**
     * Challenger-chosen problem filters (direct-challenge flow only; null =
     * no filter, matchmaking races leave all four null). Hard constraints on
     * problem selection at ready time.
     */
    ratingMin: integer("rating_min"),
    ratingMax: integer("rating_max"),
    problemDateFrom: timestamp("problem_date_from", { withTimezone: true }),
    problemDateTo: timestamp("problem_date_to", { withTimezone: true }),
    /**
     * Why the last both-ready attempt failed to select a problem (values from
     * `ProblemSelectionFailureReason` in src/lib/types.ts); null when the last
     * attempt succeeded or none was made. Cleared when readying re-attempts.
     */
    problemSelectionFailedReason: text("problem_selection_failed_reason"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    outcome: raceOutcomeEnum("outcome"),
    winnerId: uuid("winner_id"),
    winningSubmissionId: bigint("winning_submission_id", { mode: "number" }),
    eloDeltaP1: integer("elo_delta_p1"),
    eloDeltaP2: integer("elo_delta_p2"),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    /**
     * Per-player presence heartbeats, stamped by each client's verdict-poll
     * requests while the race is active. An opponent stamp staler than
     * ABSENCE_FORFEIT_SEC (with startedAt as the floor) forfeits the race to
     * the present player. Null until a player's first poll.
     */
    p1LastSeenAt: timestamp("p1_last_seen_at", { withTimezone: true }),
    p2LastSeenAt: timestamp("p2_last_seen_at", { withTimezone: true }),
    livekitRoom: text("livekit_room").notNull(),
    /** Player with an outstanding draw offer (mutual-consent draw); null when none. */
    drawOfferBy: uuid("draw_offer_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("races_status_idx").on(t.status),
    index("races_status_ends_at_idx").on(t.status, t.endsAt),
    index("races_challenge_token_idx").on(t.challengeToken),
  ],
);

export const raceSubmissions = pgTable(
  "race_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    raceId: uuid("race_id")
      .notNull()
      .references(() => races.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    cfSubmissionId: bigint("cf_submission_id", { mode: "number" }),
    code: text("code").notNull(),
    verdict: text("verdict"),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("race_submissions_race_id_idx").on(t.raceId)],
);

// ---------------------------------------------------------------------------
// Matchmaking
// ---------------------------------------------------------------------------

export const queueEntries = pgTable(
  "queue_entries",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id),
    elo: integer("elo").notNull(),
    enqueuedAt: timestamp("enqueued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("queue_entries_elo_idx").on(t.elo)],
);

// ---------------------------------------------------------------------------
// Elo history
// ---------------------------------------------------------------------------

export const eloHistory = pgTable(
  "elo_history",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    raceId: uuid("race_id")
      .notNull()
      .references(() => races.id),
    eloBefore: integer("elo_before").notNull(),
    eloAfter: integer("elo_after").notNull(),
    delta: integer("delta").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("elo_history_user_id_created_at_idx").on(t.userId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    raceId: uuid("race_id")
      .notNull()
      .references(() => races.id),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => users.id),
    reportedId: uuid("reported_id")
      .notNull()
      .references(() => users.id),
    /** Values constrained by `ReportReason` in src/lib/types.ts, not a PG enum. */
    reason: text("reason").notNull(),
    note: text("note"),
    /** `'open' | 'resolved'` — see `ReportStatus` in src/lib/types.ts. */
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("reports_race_id_reporter_id_idx").on(t.raceId, t.reporterId),
    index("reports_status_idx").on(t.status),
  ],
);

// ---------------------------------------------------------------------------
// Tournament registration
// ---------------------------------------------------------------------------

/**
 * Launch tournament registration (issue #209). One row per user — `userId`
 * is the PK, so registering twice is an upsert, not a duplicate. No
 * `cfHandle`/rating snapshot: join `users` for those at read time so seeding
 * always reflects current Elo.
 */
export const tournamentRegistrations = pgTable("tournament_registrations", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  githubUrl: text("github_url"),
  linkedinUrl: text("linkedin_url"),
  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // Added in issue #235 for bracket seeding/contact; all nullable since prod
  // rows already exist and registration predates these fields.
  firstName: text("first_name"),
  lastName: text("last_name"),
  email: text("email"),
  location: text("location"),
});

// ---------------------------------------------------------------------------
// Tournament bracket
//
// Single-tournament assumption (issue #235): exactly one bracket is live at a
// time. There is no tournament/version id on this table — re-seeding wipes
// all `tournament_matches` rows and regenerates the full bracket from
// scratch rather than versioning multiple brackets side by side.
// ---------------------------------------------------------------------------

export const tournamentMatches = pgTable(
  "tournament_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    round: integer("round").notNull(), // 1..6; 1 = round of 64
    slot: integer("slot").notNull(), // 0-based within round
    p1Id: uuid("p1_id").references(() => users.id), // null = bye / TBD
    p2Id: uuid("p2_id").references(() => users.id),
    p1Seed: integer("p1_seed"), // 1-based seed snapshot, display-only
    p2Seed: integer("p2_seed"),
    raceId: uuid("race_id").references(() => races.id), // re-assignable; null until race created
    winnerId: uuid("winner_id").references(() => users.id),
    /** `'pending' | 'done'` — TournamentMatchStatus in types.ts; text not PG enum (cheaper future migrations, matches reports.status pattern). */
    status: text("status").notNull().default("pending"),
    /** `'race' | 'walkover' | 'bye' | null` — how a done match was decided. */
    resolution: text("resolution"),
    /** Informational 24h window end, stamped at race creation. No cron enforces it — admin resolves. */
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tournament_matches_round_slot_idx").on(t.round, t.slot),
    index("tournament_matches_race_id_idx").on(t.raceId),
  ],
);

// ---------------------------------------------------------------------------
// Inferred row types
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type HandleVerification = typeof handleVerifications.$inferSelect;
export type NewHandleVerification = typeof handleVerifications.$inferInsert;

export type Problem = typeof problems.$inferSelect;
export type NewProblem = typeof problems.$inferInsert;

export type ProblemStatementRow = typeof problemStatements.$inferSelect;
export type NewProblemStatementRow = typeof problemStatements.$inferInsert;

export type UserProblem = typeof userProblems.$inferSelect;
export type NewUserProblem = typeof userProblems.$inferInsert;

export type Race = typeof races.$inferSelect;
export type NewRace = typeof races.$inferInsert;

export type RaceSubmission = typeof raceSubmissions.$inferSelect;
export type NewRaceSubmission = typeof raceSubmissions.$inferInsert;

export type QueueEntry = typeof queueEntries.$inferSelect;
export type NewQueueEntry = typeof queueEntries.$inferInsert;

export type EloHistoryEntry = typeof eloHistory.$inferSelect;
export type NewEloHistoryEntry = typeof eloHistory.$inferInsert;

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;

export type TournamentRegistration = typeof tournamentRegistrations.$inferSelect;
export type NewTournamentRegistration = typeof tournamentRegistrations.$inferInsert;

export type TournamentMatch = typeof tournamentMatches.$inferSelect;
export type NewTournamentMatch = typeof tournamentMatches.$inferInsert;
