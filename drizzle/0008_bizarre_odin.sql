CREATE TABLE "lifting_goal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"effective_from" date NOT NULL,
	"statement" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "lifting_goal_effective_from_idx" ON "lifting_goal" USING btree ("effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "lifting_goal_effective_from_key" ON "lifting_goal" USING btree ("effective_from") WHERE "lifting_goal"."deleted_at" is null;