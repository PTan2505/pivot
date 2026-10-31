CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capture_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"method" text DEFAULT 'server' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"quality" text,
	"quality_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"viewport_asset_id" text,
	"full_asset_id" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "meta" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "capture_quality" text;--> statement-breakpoint
ALTER TABLE "capture_attempts" ADD CONSTRAINT "capture_attempts_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capture_attempts_resource_idx" ON "capture_attempts" USING btree ("resource_id","requested_at");--> statement-breakpoint
CREATE INDEX "capture_attempts_status_idx" ON "capture_attempts" USING btree ("status");