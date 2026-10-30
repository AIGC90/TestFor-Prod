CREATE TABLE "notification_reads" (
	"user_id" integer NOT NULL,
	"event_id" integer NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_reads_user_event" ON "notification_reads" USING btree ("user_id","event_id");