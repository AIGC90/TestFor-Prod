CREATE TABLE "gl_vouchers" (
	"id" serial PRIMARY KEY NOT NULL,
	"voucher_no" text NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"movement_id" integer NOT NULL,
	"debit_account" text NOT NULL,
	"credit_account" text NOT NULL,
	"amount" numeric(16, 2) NOT NULL,
	"narration" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gl_vouchers_movement_id_unique" UNIQUE("movement_id")
);
--> statement-breakpoint
CREATE TABLE "stock_balances" (
	"item_id" integer NOT NULL,
	"store_id" integer NOT NULL,
	"qty" numeric(14, 3) DEFAULT 0 NOT NULL,
	"value" numeric(16, 2) DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_balances_item_id_store_id_pk" PRIMARY KEY("item_id","store_id")
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"doc_no" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"item_id" integer NOT NULL,
	"store_id" integer NOT NULL,
	"to_store_id" integer,
	"qty" numeric(14, 3) NOT NULL,
	"unit_rate" numeric(16, 2) DEFAULT 0 NOT NULL,
	"value" numeric(16, 2) DEFAULT 0 NOT NULL,
	"serials" text[] DEFAULT '{}'::text[] NOT NULL,
	"vehicle_no" text,
	"lr_no" text,
	"ref_type" text,
	"ref_id" integer,
	"ref_no" text,
	"remarks" text,
	"moved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"gl_voucher_id" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_pieces" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"serial" text NOT NULL,
	"store_id" integer,
	"state" text DEFAULT 'in_stock' NOT NULL,
	"vehicle_no" text,
	"last_movement_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_to_store_id_stores_id_fk" FOREIGN KEY ("to_store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_pieces" ADD CONSTRAINT "stock_pieces_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_pieces" ADD CONSTRAINT "stock_pieces_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_movements_item_store" ON "stock_movements" USING btree ("item_id","store_id");--> statement-breakpoint
CREATE INDEX "stock_movements_ref" ON "stock_movements" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_pieces_item_serial" ON "stock_pieces" USING btree ("item_id","serial");