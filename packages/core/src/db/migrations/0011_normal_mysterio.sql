CREATE TABLE "design_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"n" integer NOT NULL,
	"resource_id" text,
	"title" text NOT NULL,
	"url" text,
	"source" text NOT NULL,
	"why" text DEFAULT '' NOT NULL,
	"take" text DEFAULT '' NOT NULL,
	"avoid" text DEFAULT '' NOT NULL,
	"preview_key" text,
	"preview_storage" text,
	"preview_error" text,
	"selected" boolean DEFAULT false NOT NULL,
	"selected_words" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "design_candidates" ADD CONSTRAINT "design_candidates_session_id_design_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."design_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "design_candidates_n_idx" ON "design_candidates" USING btree ("session_id","n");