CREATE TABLE "design_mockups" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"snapshot_id" text,
	"round" integer NOT NULL,
	"n" integer NOT NULL,
	"title" text NOT NULL,
	"html" text NOT NULL,
	"round_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "design_decisions" ADD COLUMN "source" text DEFAULT 'agent' NOT NULL;--> statement-breakpoint
ALTER TABLE "design_mockups" ADD CONSTRAINT "design_mockups_session_id_design_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."design_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "design_mockups_version_idx" ON "design_mockups" USING btree ("session_id","round","n");