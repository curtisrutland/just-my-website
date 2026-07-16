CREATE TABLE "panel_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"active_recipe" jsonb,
	"active_recipe_norm" jsonb,
	"source_url" text,
	"set_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
