CREATE TABLE "design_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"round" integer NOT NULL,
	"mockup_id" text,
	"mockup_digest" text,
	"text" text DEFAULT '' NOT NULL,
	"width" integer,
	"pins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"addressed_round" integer,
	"source" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"round" integer NOT NULL,
	"addresses_feedback" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"design_system_summary" text,
	"design_system_markdown" text,
	"design_system_digest" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "design_decisions" ADD COLUMN "design_system_digest" text;--> statement-breakpoint
ALTER TABLE "design_feedback" ADD CONSTRAINT "design_feedback_session_id_design_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."design_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_rounds" ADD CONSTRAINT "design_rounds_session_id_design_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."design_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "design_feedback_session_idx" ON "design_feedback" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "design_rounds_round_idx" ON "design_rounds" USING btree ("session_id","round");