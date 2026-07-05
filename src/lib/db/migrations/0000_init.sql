CREATE TYPE "public"."race_outcome" AS ENUM('p1_win', 'p2_win', 'draw', 'aborted');--> statement-breakpoint
CREATE TYPE "public"."race_status" AS ENUM('pending', 'ready', 'active', 'finished', 'aborted');--> statement-breakpoint
CREATE TABLE "cf_credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"encrypted_password" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cf_sessions" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"cookie_jar" jsonb NOT NULL,
	"csrf_token" text,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "elo_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"race_id" uuid NOT NULL,
	"elo_before" integer NOT NULL,
	"elo_after" integer NOT NULL,
	"delta" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "problem_statements" (
	"problem_id" text PRIMARY KEY NOT NULL,
	"html" text NOT NULL,
	"samples" jsonb NOT NULL,
	"scraped_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "problems" (
	"id" text PRIMARY KEY NOT NULL,
	"contest_id" integer NOT NULL,
	"index" text NOT NULL,
	"name" text NOT NULL,
	"rating" integer NOT NULL,
	"tags" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "queue_entries" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"elo" integer NOT NULL,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "race_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"cf_submission_id" bigint,
	"code" text NOT NULL,
	"verdict" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "races" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "race_status" DEFAULT 'pending' NOT NULL,
	"challenge_token" text,
	"p1_id" uuid NOT NULL,
	"p2_id" uuid,
	"p1_ready" boolean DEFAULT false NOT NULL,
	"p2_ready" boolean DEFAULT false NOT NULL,
	"problem_id" text,
	"time_limit_sec" integer DEFAULT 2400 NOT NULL,
	"started_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"outcome" "race_outcome",
	"winner_id" uuid,
	"winning_submission_id" bigint,
	"elo_delta_p1" integer,
	"elo_delta_p2" integer,
	"last_polled_at" timestamp with time zone,
	"livekit_room" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "races_challenge_token_unique" UNIQUE("challenge_token")
);
--> statement-breakpoint
CREATE TABLE "user_problems" (
	"user_id" uuid NOT NULL,
	"problem_id" text NOT NULL,
	"solved" boolean NOT NULL,
	CONSTRAINT "user_problems_user_id_problem_id_pk" PRIMARY KEY("user_id","problem_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_id" text NOT NULL,
	"username" text NOT NULL,
	"cf_handle" text,
	"cf_rating" integer,
	"cf_linked_at" timestamp with time zone,
	"elo" integer DEFAULT 1200 NOT NULL,
	"races_played" integer DEFAULT 0 NOT NULL,
	"cpp_template" text DEFAULT '#include <bits/stdc++.h>
using namespace std;

int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);

}
' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id"),
	CONSTRAINT "users_cf_handle_unique" UNIQUE("cf_handle")
);
--> statement-breakpoint
ALTER TABLE "cf_credentials" ADD CONSTRAINT "cf_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cf_sessions" ADD CONSTRAINT "cf_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "elo_history" ADD CONSTRAINT "elo_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "elo_history" ADD CONSTRAINT "elo_history_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "problem_statements" ADD CONSTRAINT "problem_statements_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_submissions" ADD CONSTRAINT "race_submissions_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "race_submissions" ADD CONSTRAINT "race_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_p1_id_users_id_fk" FOREIGN KEY ("p1_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_p2_id_users_id_fk" FOREIGN KEY ("p2_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_problems" ADD CONSTRAINT "user_problems_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_problems" ADD CONSTRAINT "user_problems_problem_id_problems_id_fk" FOREIGN KEY ("problem_id") REFERENCES "public"."problems"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "elo_history_user_id_created_at_idx" ON "elo_history" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "queue_entries_elo_idx" ON "queue_entries" USING btree ("elo");--> statement-breakpoint
CREATE INDEX "race_submissions_race_id_idx" ON "race_submissions" USING btree ("race_id");--> statement-breakpoint
CREATE INDEX "races_status_idx" ON "races" USING btree ("status");--> statement-breakpoint
CREATE INDEX "races_status_ends_at_idx" ON "races" USING btree ("status","ends_at");--> statement-breakpoint
CREATE INDEX "races_challenge_token_idx" ON "races" USING btree ("challenge_token");--> statement-breakpoint
CREATE INDEX "user_problems_user_id_idx" ON "user_problems" USING btree ("user_id");