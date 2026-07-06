CREATE TABLE "shopping_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"category" text NOT NULL,
	"text" text NOT NULL,
	"status" text DEFAULT 'needed' NOT NULL,
	"checked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "shopping_item_active_idx" ON "shopping_item" USING btree ("category","text") WHERE "shopping_item"."deleted_at" is null and "shopping_item"."status" = 'needed';--> statement-breakpoint
CREATE INDEX "shopping_item_bought_idx" ON "shopping_item" USING btree ("checked_at") WHERE "shopping_item"."deleted_at" is null and "shopping_item"."status" = 'bought';