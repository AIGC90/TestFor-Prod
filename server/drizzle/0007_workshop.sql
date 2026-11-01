CREATE TABLE "driver_charges" (
	"id" serial PRIMARY KEY NOT NULL,
	"dc_no" text NOT NULL,
	"driver_name" text NOT NULL,
	"incident_date" timestamp with time zone NOT NULL,
	"category" text NOT NULL,
	"vehicle_no" text,
	"amount" numeric(14, 2) NOT NULL,
	"ref_no" text,
	"description" text NOT NULL,
	"recovery_plan" text DEFAULT 'one_time' NOT NULL,
	"instalments" integer DEFAULT 1 NOT NULL,
	"recovered" numeric(14, 2) DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_charges_dc_no_unique" UNIQUE("dc_no")
);
--> statement-breakpoint
CREATE TABLE "gate_passes" (
	"id" serial PRIMARY KEY NOT NULL,
	"gp_no" text NOT NULL,
	"kind" text NOT NULL,
	"from_store_id" integer NOT NULL,
	"party_id" integer NOT NULL,
	"vehicle_no" text,
	"job_card_id" integer,
	"expected_return" timestamp with time zone,
	"remark" text,
	"lines" jsonb NOT NULL,
	"estimated_value" numeric(14, 2),
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"returned_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gate_passes_gp_no_unique" UNIQUE("gp_no")
);
--> statement-breakpoint
CREATE TABLE "job_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"jc_no" text NOT NULL,
	"vehicle_no" text NOT NULL,
	"driver_name" text,
	"job_type" text DEFAULT 'own_workshop' NOT NULL,
	"service_type" text NOT NULL,
	"store_id" integer,
	"party_id" integer,
	"inspected_by" text,
	"running_km" numeric(12, 1),
	"pm_schedule_id" integer,
	"problem" text NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"estimated_cost" numeric(14, 2),
	"labour_cost" numeric(14, 2) DEFAULT 0 NOT NULL,
	"parts_cost" numeric(14, 2) DEFAULT 0 NOT NULL,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"work_done" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_cards_jc_no_unique" UNIQUE("jc_no")
);
--> statement-breakpoint
CREATE TABLE "pm_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_no" text NOT NULL,
	"task" text NOT NULL,
	"category" text,
	"interval_km" numeric(12, 1),
	"interval_days" integer,
	"last_done_at" timestamp with time zone,
	"last_done_km" numeric(12, 1),
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repair_bills" (
	"id" serial PRIMARY KEY NOT NULL,
	"rb_no" text NOT NULL,
	"vendor_bill_no" text,
	"party_id" integer NOT NULL,
	"vehicle_no" text NOT NULL,
	"job_card_id" integer,
	"bill_date" timestamp with time zone NOT NULL,
	"taxable" numeric(14, 2) NOT NULL,
	"gst_rate" numeric(5, 2) DEFAULT 18 NOT NULL,
	"inter_state" integer DEFAULT 0 NOT NULL,
	"cgst" numeric(14, 2) DEFAULT 0 NOT NULL,
	"sgst" numeric(14, 2) DEFAULT 0 NOT NULL,
	"igst" numeric(14, 2) DEFAULT 0 NOT NULL,
	"tds_rate" numeric(5, 2) DEFAULT 2 NOT NULL,
	"tds" numeric(14, 2) DEFAULT 0 NOT NULL,
	"net_payable" numeric(14, 2) NOT NULL,
	"description" text,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"paid_at" timestamp with time zone,
	"payment_ref" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repair_bills_rb_no_unique" UNIQUE("rb_no")
);
--> statement-breakpoint
CREATE TABLE "tool_checklists" (
	"id" serial PRIMARY KEY NOT NULL,
	"tc_no" text NOT NULL,
	"audit_type" text NOT NULL,
	"vehicle_no" text NOT NULL,
	"driver_name" text NOT NULL,
	"inspector" text,
	"audit_date" timestamp with time zone DEFAULT now() NOT NULL,
	"tools" jsonb NOT NULL,
	"missing_count" integer DEFAULT 0 NOT NULL,
	"remarks" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tool_checklists_tc_no_unique" UNIQUE("tc_no")
);
--> statement-breakpoint
ALTER TABLE "gate_passes" ADD CONSTRAINT "gate_passes_from_store_id_stores_id_fk" FOREIGN KEY ("from_store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cards" ADD CONSTRAINT "job_cards_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;