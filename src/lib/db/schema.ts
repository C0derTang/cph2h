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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// Codeforces account linking
// ---------------------------------------------------------------------------

export const cfCredentials = pgTable("cf_credentials", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  /** Base64-encoded AES-256-GCM ciphertext of the CF password. */
  encryptedPassword: text("encrypted_password").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

export const cfSessions = pgTable("cf_sessions", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  cookieJar: jsonb("cookie_jar").notNull(),
  csrfToken: text("csrf_token"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// Problems
// ---------------------------------------------------------------------------

export const problems = pgTable("problems", {
  /** e.g. "1794C" — see `problemIdOf` in src/lib/types.ts. */
  id: text("id").primaryKey(),
  contestId: integer("contest_id").notNull(),
  index: text("index").notNull(),
  name: text("name").notNull(),
  rating: integer("rating").notNull(),
  tags: jsonb("tags").notNull().$type<string[]>(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
});

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
    startedAt: timestamp("started_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    outcome: raceOutcomeEnum("outcome"),
    winnerId: uuid("winner_id"),
    winningSubmissionId: bigint("winning_submission_id", { mode: "number" }),
    eloDeltaP1: integer("elo_delta_p1"),
    eloDeltaP2: integer("elo_delta_p2"),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
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
// Inferred row types
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type CfCredential = typeof cfCredentials.$inferSelect;
export type NewCfCredential = typeof cfCredentials.$inferInsert;

export type CfSession = typeof cfSessions.$inferSelect;
export type NewCfSession = typeof cfSessions.$inferInsert;

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
