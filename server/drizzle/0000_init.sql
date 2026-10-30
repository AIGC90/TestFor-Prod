CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" integer,
	"user_name" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "traccar_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"traccar_event_id" integer,
	"type" text NOT NULL,
	"device_id" integer,
	"device_name" text,
	"event_time" timestamp with time zone,
	"payload" jsonb NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"traccar_user_id" integer PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "traccar_events_event_id" ON "traccar_events" USING btree ("traccar_event_id");