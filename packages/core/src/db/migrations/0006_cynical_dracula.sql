CREATE TABLE "resource_links" (
	"id" text PRIMARY KEY NOT NULL,
	"from_id" text NOT NULL,
	"to_id" text NOT NULL,
	"kind" text NOT NULL,
	"confirmed" integer DEFAULT 1 NOT NULL,
	"origin" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resource_links" ADD CONSTRAINT "resource_links_from_id_resources_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_links" ADD CONSTRAINT "resource_links_to_id_resources_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "resource_links_unique_idx" ON "resource_links" USING btree ("from_id","to_id","kind");--> statement-breakpoint
CREATE INDEX "resource_links_to_idx" ON "resource_links" USING btree ("to_id");