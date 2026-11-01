CREATE TABLE "goods_receipts" (
	"id" serial PRIMARY KEY NOT NULL,
	"rec_no" text NOT NULL,
	"po_no" text,
	"supplier_id" integer,
	"store_id" integer NOT NULL,
	"lr_no" text,
	"request_id" integer,
	"lines" jsonb NOT NULL,
	"status" text DEFAULT 'expected' NOT NULL,
	"expected_at" timestamp with time zone,
	"landed_at" timestamp with time zone,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_receipts_rec_no_unique" UNIQUE("rec_no")
);
--> statement-breakpoint
CREATE TABLE "group_loans" (
	"id" serial PRIMARY KEY NOT NULL,
	"loan_no" text NOT NULL,
	"direction" text NOT NULL,
	"sister_id" integer NOT NULL,
	"tyre_serial" text NOT NULL,
	"tyre_spec" text NOT NULL,
	"loan_date" timestamp with time zone NOT NULL,
	"expected_return" timestamp with time zone,
	"location" text,
	"challan_no" text,
	"remarks" text,
	"status" text DEFAULT 'active' NOT NULL,
	"returned_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_loans_loan_no_unique" UNIQUE("loan_no")
);
--> statement-breakpoint
CREATE TABLE "opening_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"store_id" integer NOT NULL,
	"lines" jsonb NOT NULL,
	"total_qty" numeric(14, 3) NOT NULL,
	"total_value" numeric(16, 2) NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opening_batches_batch_id_unique" UNIQUE("batch_id")
);
--> statement-breakpoint
CREATE TABLE "stock_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"req_no" text NOT NULL,
	"kind" text NOT NULL,
	"store_id" integer NOT NULL,
	"from_store_id" integer,
	"needed_by" timestamp with time zone,
	"lines" jsonb NOT NULL,
	"notes" text,
	"status" text DEFAULT 'open' NOT NULL,
	"requested_by_name" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_requests_req_no_unique" UNIQUE("req_no")
);
--> statement-breakpoint
CREATE TABLE "stock_sales" (
	"id" serial PRIMARY KEY NOT NULL,
	"sale_no" text NOT NULL,
	"sale_date" timestamp with time zone DEFAULT now() NOT NULL,
	"buyer_id" integer NOT NULL,
	"store_id" integer NOT NULL,
	"lines" jsonb NOT NULL,
	"taxable" numeric(16, 2) DEFAULT 0 NOT NULL,
	"cgst" numeric(16, 2) DEFAULT 0 NOT NULL,
	"sgst" numeric(16, 2) DEFAULT 0 NOT NULL,
	"igst" numeric(16, 2) DEFAULT 0 NOT NULL,
	"total" numeric(16, 2) DEFAULT 0 NOT NULL,
	"remarks" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_sales_sale_no_unique" UNIQUE("sale_no")
);
--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_batches" ADD CONSTRAINT "opening_batches_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_requests" ADD CONSTRAINT "stock_requests_from_store_id_stores_id_fk" FOREIGN KEY ("from_store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_sales" ADD CONSTRAINT "stock_sales_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;