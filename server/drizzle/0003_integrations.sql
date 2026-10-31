CREATE TABLE "integrations" (
	"key" text PRIMARY KEY NOT NULL,
	"secret" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
