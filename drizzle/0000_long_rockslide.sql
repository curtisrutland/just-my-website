CREATE TABLE "macro_day_tag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"day" date NOT NULL,
	"kind" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "macro_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"consumed_on" date NOT NULL,
	"food_id" uuid,
	"quantity_grams" real NOT NULL,
	"confidence" text NOT NULL,
	"calories" real,
	"protein_content" real,
	"fat_content" real,
	"carbohydrate_content" real,
	"fiber_content" real,
	"sugar_content" real,
	"sodium_content" real,
	"saturated_fat_content" real,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "macro_food" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"fdc_id" integer,
	"serving_label" text,
	"serving_grams" real,
	"calories" real,
	"protein_content" real,
	"fat_content" real,
	"carbohydrate_content" real,
	"fiber_content" real,
	"sugar_content" real,
	"sodium_content" real,
	"saturated_fat_content" real
);
--> statement-breakpoint
CREATE TABLE "macro_target_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"kind" text NOT NULL,
	"effective_from" date NOT NULL,
	"calories" real,
	"protein_content" real,
	"fat_content" real,
	"carbohydrate_content" real,
	"meta" jsonb
);
--> statement-breakpoint
ALTER TABLE "macro_entry" ADD CONSTRAINT "macro_entry_food_id_macro_food_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."macro_food"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "macro_day_tag_day_key" ON "macro_day_tag" USING btree ("day") WHERE "macro_day_tag"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "macro_entry_consumed_on_idx" ON "macro_entry" USING btree ("consumed_on");--> statement-breakpoint
CREATE INDEX "macro_food_name_idx" ON "macro_food" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "macro_food_fdc_id_key" ON "macro_food" USING btree ("fdc_id") WHERE "macro_food"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "macro_target_profile_kind_effective_from_idx" ON "macro_target_profile" USING btree ("kind","effective_from");