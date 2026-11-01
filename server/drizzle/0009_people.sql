CREATE TABLE "attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"doc_type" text NOT NULL,
	"doc_id" integer NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_docs" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject_type" text NOT NULL,
	"subject" text NOT NULL,
	"doc_type" text NOT NULL,
	"doc_no" text,
	"authority" text,
	"issue_date" date,
	"expiry_date" date,
	"description" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"verified_at" timestamp with time zone,
	"superseded_by_id" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"driver_id" integer NOT NULL,
	"vehicle_no" text NOT NULL,
	"from_at" timestamp with time zone DEFAULT now() NOT NULL,
	"to_at" timestamp with time zone,
	"remarks" text,
	"created_by" integer
);
--> statement-breakpoint
CREATE TABLE "driver_attendance" (
	"driver_id" integer NOT NULL,
	"date" date NOT NULL,
	"code" text NOT NULL,
	"remarks" text,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_attendance_driver_id_date_pk" PRIMARY KEY("driver_id","date")
);
--> statement-breakpoint
CREATE TABLE "driver_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"traccar_driver_id" integer,
	"name" text NOT NULL,
	"phone" text,
	"licence_no" text,
	"licence_expiry" date,
	"aadhar" text,
	"monthly_salary" numeric(14, 2) DEFAULT 0 NOT NULL,
	"daily_bata" numeric(14, 2) DEFAULT 0 NOT NULL,
	"trip_allowance" numeric(14, 2) DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"joined_on" date,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_profiles_traccar_driver_id_unique" UNIQUE("traccar_driver_id")
);
--> statement-breakpoint
CREATE TABLE "emergency_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"exp_no" text NOT NULL,
	"staff_id" integer NOT NULL,
	"date" date NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"paid_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_claims_exp_no_unique" UNIQUE("exp_no")
);
--> statement-breakpoint
CREATE TABLE "field_staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"team" text,
	"city" text,
	"phone" text,
	"traccar_device_id" integer,
	"monthly_target" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"ft_no" text NOT NULL,
	"staff_id" integer NOT NULL,
	"party_id" integer,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"address" text,
	"city" text,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'assigned' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"amount_collected" numeric(14, 2),
	"rating" integer,
	"outcome" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_tasks_ft_no_unique" UNIQUE("ft_no")
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"inc_no" text NOT NULL,
	"vehicle_no" text NOT NULL,
	"driver_name" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"type" text NOT NULL,
	"narrative" text NOT NULL,
	"location" text,
	"latitude" double precision,
	"longitude" double precision,
	"severity" text DEFAULT 'minor' NOT NULL,
	"rsa_provider" text,
	"rsa_status" text DEFAULT 'none' NOT NULL,
	"repair_cost" numeric(14, 2),
	"sos_id" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incidents_inc_no_unique" UNIQUE("inc_no")
);
--> statement-breakpoint
CREATE TABLE "insurance_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"clm_no" text NOT NULL,
	"incident_id" integer,
	"vehicle_no" text NOT NULL,
	"insurer" text NOT NULL,
	"policy_no" text,
	"insurer_claim_no" text,
	"surveyor" text,
	"estimated_damage" numeric(14, 2) DEFAULT 0 NOT NULL,
	"approved_payout" numeric(14, 2),
	"settled_amount" numeric(14, 2),
	"status" text DEFAULT 'filed' NOT NULL,
	"filed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	"remarks" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insurance_claims_clm_no_unique" UNIQUE("clm_no")
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"pr_no" text NOT NULL,
	"month" text NOT NULL,
	"lines" jsonb NOT NULL,
	"gross" numeric(14, 2) NOT NULL,
	"deductions" numeric(14, 2) NOT NULL,
	"net" numeric(14, 2) NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"paid_at" timestamp with time zone,
	"payment_ref" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_runs_pr_no_unique" UNIQUE("pr_no"),
	CONSTRAINT "payroll_runs_month_unique" UNIQUE("month")
);
--> statement-breakpoint
CREATE TABLE "sos_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"sos_no" text NOT NULL,
	"device_id" integer,
	"vehicle_no" text NOT NULL,
	"driver_name" text,
	"driver_phone" text,
	"trigger" text NOT NULL,
	"severity" text NOT NULL,
	"speed_kmh" numeric(10, 2),
	"ignition" text,
	"latitude" double precision,
	"longitude" double precision,
	"address" text,
	"status" text DEFAULT 'active' NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"responded_by" integer,
	"responder" text,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"false_alarm" integer DEFAULT 0 NOT NULL,
	"incident_id" integer,
	"traccar_event_id" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sos_incidents_sos_no_unique" UNIQUE("sos_no"),
	CONSTRAINT "sos_incidents_traccar_event_id_unique" UNIQUE("traccar_event_id")
);
--> statement-breakpoint
CREATE TABLE "staff_attendance" (
	"staff_id" integer NOT NULL,
	"date" date NOT NULL,
	"check_in" timestamp with time zone,
	"check_out" timestamp with time zone,
	"km" numeric(10, 2),
	"check_in_lat" double precision,
	"check_in_lon" double precision,
	CONSTRAINT "staff_attendance_staff_id_date_pk" PRIMARY KEY("staff_id","date")
);
--> statement-breakpoint
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_driver_id_driver_profiles_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_attendance" ADD CONSTRAINT "driver_attendance_driver_id_driver_profiles_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."driver_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_staff_id_field_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."field_staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_tasks" ADD CONSTRAINT "field_tasks_staff_id_field_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."field_staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_staff_id_field_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."field_staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_doc_idx" ON "attachments" USING btree ("doc_type","doc_id");