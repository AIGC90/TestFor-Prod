CREATE TABLE "tyre_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"tyre_id" integer NOT NULL,
	"type" text NOT NULL,
	"vehicle_no" text,
	"position" text,
	"to_vehicle_no" text,
	"to_position" text,
	"odometer_km" numeric(12, 1),
	"nsd" numeric(5, 1),
	"pressure" numeric(5, 1),
	"cost" numeric(14, 2),
	"technician" text,
	"ref_no" text,
	"remarks" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer
);
--> statement-breakpoint
CREATE TABLE "tyre_interchanges" (
	"id" serial PRIMARY KEY NOT NULL,
	"ti_no" text NOT NULL,
	"kind" text NOT NULL,
	"lines" jsonb NOT NULL,
	"remarks" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer,
	CONSTRAINT "tyre_interchanges_ti_no_unique" UNIQUE("ti_no")
);
--> statement-breakpoint
CREATE TABLE "tyre_layouts" (
	"vehicle_no" text PRIMARY KEY NOT NULL,
	"layout" text NOT NULL,
	"positions" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tyres" (
	"id" serial PRIMARY KEY NOT NULL,
	"serial" text NOT NULL,
	"brand" text NOT NULL,
	"model" text,
	"size" text NOT NULL,
	"tyre_type" text DEFAULT 'radial' NOT NULL,
	"purchase_cost" numeric(14, 2) DEFAULT 0 NOT NULL,
	"purchase_date" timestamp with time zone,
	"vendor_id" integer,
	"status" text DEFAULT 'in_store' NOT NULL,
	"vehicle_no" text,
	"position" text,
	"fitted_at" timestamp with time zone,
	"fitted_km" numeric(12, 1),
	"closed_km" numeric(12, 1) DEFAULT 0 NOT NULL,
	"original_nsd" numeric(5, 1) DEFAULT 16 NOT NULL,
	"last_nsd" numeric(5, 1),
	"last_nsd_at" timestamp with time zone,
	"target_pressure" numeric(5, 1),
	"last_pressure" numeric(5, 1),
	"retread_count" integer DEFAULT 0 NOT NULL,
	"upkeep_cost" numeric(14, 2) DEFAULT 0 NOT NULL,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tyres_serial_unique" UNIQUE("serial")
);
--> statement-breakpoint
ALTER TABLE "tyre_events" ADD CONSTRAINT "tyre_events_tyre_id_tyres_id_fk" FOREIGN KEY ("tyre_id") REFERENCES "public"."tyres"("id") ON DELETE no action ON UPDATE no action;