ALTER TABLE "queue_entries" ADD COLUMN "rating_min" integer;--> statement-breakpoint
ALTER TABLE "queue_entries" ADD COLUMN "rating_max" integer;--> statement-breakpoint
ALTER TABLE "queue_entries" ADD COLUMN "date_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "queue_entries" ADD COLUMN "date_to" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "queue_entries" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "races" ADD COLUMN "ready_deadline_at" timestamp with time zone;