CREATE TABLE "api_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cf_rate_limiter" (
	"id" integer PRIMARY KEY NOT NULL,
	"next_slot_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO cf_rate_limiter (id, next_slot_at) VALUES (1, now()) ON CONFLICT DO NOTHING;
