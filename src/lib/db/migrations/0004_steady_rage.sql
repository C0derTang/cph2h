ALTER TABLE "problems" ADD COLUMN "contest_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "races" ADD COLUMN "rating_min" integer;--> statement-breakpoint
ALTER TABLE "races" ADD COLUMN "rating_max" integer;--> statement-breakpoint
ALTER TABLE "races" ADD COLUMN "problem_date_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "races" ADD COLUMN "problem_date_to" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "races" ADD COLUMN "problem_selection_failed_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "solve_history_synced_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "problems_rating_contest_started_at_idx" ON "problems" USING btree ("rating","contest_started_at");