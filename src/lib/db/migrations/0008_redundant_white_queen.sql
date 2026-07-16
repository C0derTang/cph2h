-- An orphaned prototype table named tournament_registrations (user_id, cf_handle,
-- status, stripe_session_id, paid_at) exists in dev and prod, created outside
-- drizzle migrations. It blocks this CREATE. Confirmed disposable — drop it first.
DROP TABLE IF EXISTS "tournament_registrations";
--> statement-breakpoint
CREATE TABLE "tournament_registrations" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"github_url" text,
	"linkedin_url" text,
	"terms_accepted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tournament_registrations" ADD CONSTRAINT "tournament_registrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;