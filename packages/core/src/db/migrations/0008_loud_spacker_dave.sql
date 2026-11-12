CREATE TABLE "asset_annotations" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"kind" text DEFAULT 'region' NOT NULL,
	"x" double precision NOT NULL,
	"y" double precision NOT NULL,
	"width" double precision DEFAULT 0 NOT NULL,
	"height" double precision DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"author" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_annotations" ADD CONSTRAINT "asset_annotations_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_annotations" ADD CONSTRAINT "asset_annotations_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_annotations_resource_idx" ON "asset_annotations" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "asset_annotations_asset_idx" ON "asset_annotations" USING btree ("asset_id");