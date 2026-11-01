CREATE TABLE "device_licenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"lic_no" text NOT NULL,
	"vehicle_no" text NOT NULL,
	"device_id" integer,
	"imei" text NOT NULL,
	"sim_operator" text,
	"sim_no" text,
	"plan" text NOT NULL,
	"activated_on" date NOT NULL,
	"expires_on" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_licenses_lic_no_unique" UNIQUE("lic_no"),
	CONSTRAINT "device_licenses_imei_unique" UNIQUE("imei")
);
--> statement-breakpoint
CREATE TABLE "fastag_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_no" text NOT NULL,
	"tag_id" text NOT NULL,
	"bank" text NOT NULL,
	"vehicle_class" text DEFAULT 'VC10' NOT NULL,
	"balance" numeric(14, 2) DEFAULT 0 NOT NULL,
	"low_balance" numeric(14, 2) DEFAULT 1000 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"balance_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fastag_accounts_tag_id_unique" UNIQUE("tag_id")
);
--> statement-breakpoint
CREATE TABLE "invoice_receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"received_on" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"tds" numeric(14, 2) DEFAULT 0 NOT NULL,
	"mode" text DEFAULT 'neft' NOT NULL,
	"reference" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"inv_no" text NOT NULL,
	"customer_id" integer NOT NULL,
	"trip_ids" integer[] DEFAULT '{}' NOT NULL,
	"lane" text,
	"invoice_date" date NOT NULL,
	"due_date" date NOT NULL,
	"description" text,
	"taxable" numeric(14, 2) NOT NULL,
	"gst_rate" numeric(5, 2) DEFAULT 5 NOT NULL,
	"inter_state" integer DEFAULT 0 NOT NULL,
	"cgst" numeric(14, 2) DEFAULT 0 NOT NULL,
	"sgst" numeric(14, 2) DEFAULT 0 NOT NULL,
	"igst" numeric(14, 2) DEFAULT 0 NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"received" numeric(14, 2) DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_inv_no_unique" UNIQUE("inv_no")
);
--> statement-breakpoint
CREATE TABLE "subscription_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"sinv_no" text NOT NULL,
	"invoice_date" date NOT NULL,
	"description" text NOT NULL,
	"lines" jsonb NOT NULL,
	"net" numeric(14, 2) NOT NULL,
	"gst" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"payment_method" text,
	"payment_ref" text,
	"status" text DEFAULT 'unpaid' NOT NULL,
	"paid_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_invoices_sinv_no_unique" UNIQUE("sinv_no")
);
--> statement-breakpoint
CREATE TABLE "toll_txns" (
	"id" serial PRIMARY KEY NOT NULL,
	"txn_ref" text NOT NULL,
	"npci_ref" text,
	"tag_id" text NOT NULL,
	"vehicle_no" text NOT NULL,
	"kind" text DEFAULT 'toll' NOT NULL,
	"plaza" text,
	"highway" text,
	"lane" text,
	"at" timestamp with time zone NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"balance_after" numeric(14, 2),
	"status" text DEFAULT 'debited' NOT NULL,
	"source" text DEFAULT 'import' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "toll_txns_txn_ref_unique" UNIQUE("txn_ref")
);
--> statement-breakpoint
ALTER TABLE "invoice_receipts" ADD CONSTRAINT "invoice_receipts_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "toll_txns_vehicle_at_idx" ON "toll_txns" USING btree ("vehicle_no","at");