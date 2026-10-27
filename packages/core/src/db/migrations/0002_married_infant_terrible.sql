CREATE TABLE "skill_packs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"author" text,
	"kind" text DEFAULT 'repo' NOT NULL,
	"repo_url" text,
	"homepage" text,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
