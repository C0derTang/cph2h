CREATE TYPE "public"."registration_status" AS ENUM('pending', 'paid');--> statement-breakpoint
CREATE TABLE "tournament_registrations" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"cf_handle" text NOT NULL,
	"status" "registration_status" DEFAULT 'pending' NOT NULL,
	"stripe_session_id" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tournament_registrations" ADD CONSTRAINT "tournament_registrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tournament_registrations_status_idx" ON "tournament_registrations" USING btree ("status");