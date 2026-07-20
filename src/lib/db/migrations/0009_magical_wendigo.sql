CREATE TABLE "tournament_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round" integer NOT NULL,
	"slot" integer NOT NULL,
	"p1_id" uuid,
	"p2_id" uuid,
	"p1_seed" integer,
	"p2_seed" integer,
	"race_id" uuid,
	"winner_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolution" text,
	"deadline_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tournament_registrations" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "tournament_registrations" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "tournament_registrations" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "tournament_registrations" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_p1_id_users_id_fk" FOREIGN KEY ("p1_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_p2_id_users_id_fk" FOREIGN KEY ("p2_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_matches" ADD CONSTRAINT "tournament_matches_winner_id_users_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_matches_round_slot_idx" ON "tournament_matches" USING btree ("round","slot");--> statement-breakpoint
CREATE INDEX "tournament_matches_race_id_idx" ON "tournament_matches" USING btree ("race_id");