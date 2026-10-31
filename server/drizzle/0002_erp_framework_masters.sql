CREATE TABLE "approval_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"doc_type" text NOT NULL,
	"doc_id" integer NOT NULL,
	"doc_no" text,
	"title" text NOT NULL,
	"summary" text,
	"amount" numeric(14, 2),
	"priority" text DEFAULT 'normal' NOT NULL,
	"approver_role" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" integer,
	"requested_by_name" text,
	"decided_by" integer,
	"decided_by_name" text,
	"decided_at" timestamp with time zone,
	"comment" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_rules" (
	"doc_type" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"min_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"approver_role" text DEFAULT 'admin' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_permissions" (
	"role" text NOT NULL,
	"doc_type" text NOT NULL,
	"can_view" boolean DEFAULT false NOT NULL,
	"can_create" boolean DEFAULT false NOT NULL,
	"can_edit" boolean DEFAULT false NOT NULL,
	"can_delete" boolean DEFAULT false NOT NULL,
	"can_approve" boolean DEFAULT false NOT NULL,
	CONSTRAINT "doc_permissions_role_doc_type_pk" PRIMARY KEY("role","doc_type")
);
--> statement-breakpoint
CREATE TABLE "field_masks" (
	"id" serial PRIMARY KEY NOT NULL,
	"doc_type" text NOT NULL,
	"role" text NOT NULL,
	"field" text NOT NULL,
	"mode" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer,
	"name" text NOT NULL,
	"level" integer DEFAULT 1 NOT NULL,
	"unit" text,
	"gst_rate" numeric(5, 2),
	"hsn" text,
	"counting_mode" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category_id" integer NOT NULL,
	"part_no" text,
	"counting_mode" text,
	"unit" text,
	"rate" numeric(14, 2),
	"gst_rate" numeric(5, 2),
	"hsn" text,
	"reorder_level" numeric(14, 3),
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer,
	CONSTRAINT "items_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "number_series" (
	"prefix" text NOT NULL,
	"year" integer NOT NULL,
	"last" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "number_series_prefix_year_pk" PRIMARY KEY("prefix","year")
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kinds" text[] DEFAULT '{}'::text[] NOT NULL,
	"gstin" text,
	"pan" text,
	"contact_person" text,
	"phone" text,
	"email" text,
	"address" text,
	"city" text,
	"state" text,
	"credit_days" integer,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer,
	CONSTRAINT "parties_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "plants" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"city" text,
	"state" text,
	"gstin" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer,
	CONSTRAINT "plants_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"plant_id" integer,
	"kind" text DEFAULT 'general' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" integer,
	CONSTRAINT "stores_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "item_categories" ADD CONSTRAINT "item_categories_parent_id_item_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."item_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_category_id_item_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."item_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_plant_id_plants_id_fk" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "field_masks_unique" ON "field_masks" USING btree ("doc_type","role","field");