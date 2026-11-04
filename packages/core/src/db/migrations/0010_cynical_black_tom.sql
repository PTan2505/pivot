ALTER TABLE "design_decisions" ADD COLUMN "mockup_id" text;--> statement-breakpoint
ALTER TABLE "design_decisions" ADD COLUMN "mockup_digest" text;--> statement-breakpoint
ALTER TABLE "design_mockups" ADD COLUMN "interactive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "design_mockups" ADD COLUMN "digest" text;--> statement-breakpoint
UPDATE "design_mockups" SET "digest" = encode(sha256(convert_to('pivot-mockup:v1:static:' || "html", 'UTF8')), 'hex');--> statement-breakpoint
ALTER TABLE "design_mockups" ALTER COLUMN "digest" SET NOT NULL;
