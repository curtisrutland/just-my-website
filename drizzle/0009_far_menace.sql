CREATE TABLE "macro_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" text NOT NULL,
	"made_on" date NOT NULL,
	"finished_on" date,
	"initial_grams" real,
	"basis" jsonb,
	"note" text,
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
ALTER TABLE "macro_entry" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
CREATE INDEX "macro_batch_name_idx" ON "macro_batch" USING btree ("name");--> statement-breakpoint
CREATE INDEX "macro_batch_finished_made_idx" ON "macro_batch" USING btree ("finished_on","made_on");--> statement-breakpoint
ALTER TABLE "macro_entry" ADD CONSTRAINT "macro_entry_batch_id_macro_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."macro_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "macro_entry" ADD CONSTRAINT "macro_entry_food_xor_batch" CHECK ("macro_entry"."food_id" is null or "macro_entry"."batch_id" is null);