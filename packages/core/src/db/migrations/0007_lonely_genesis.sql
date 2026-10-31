CREATE TABLE "design_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"direction" text DEFAULT '' NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"target_project" text DEFAULT '' NOT NULL,
	"surface" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'exploring' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"milestone" text NOT NULL,
	"markdown" text NOT NULL,
	"reference_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"kind" text NOT NULL,
	"value" jsonb NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'agent' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "design_decisions" ADD CONSTRAINT "design_decisions_session_id_design_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."design_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_snapshots" ADD CONSTRAINT "design_snapshots_session_id_design_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."design_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_suggestions" ADD CONSTRAINT "resource_suggestions_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "design_decisions_session_idx" ON "design_decisions" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "design_sessions_project_idx" ON "design_sessions" USING btree ("target_project","updated_at");--> statement-breakpoint
CREATE INDEX "design_snapshots_session_idx" ON "design_snapshots" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "resource_suggestions_resource_idx" ON "resource_suggestions" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "resource_suggestions_status_idx" ON "resource_suggestions" USING btree ("status");