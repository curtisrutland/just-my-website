ALTER TABLE "macro_food" ADD COLUMN "brand" text;--> statement-breakpoint
ALTER TABLE "macro_food" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "macro_food" ADD COLUMN "tags" text[];--> statement-breakpoint
ALTER TABLE "macro_food" ADD COLUMN "label_basis" jsonb;--> statement-breakpoint
CREATE INDEX "macro_food_category_brand_idx" ON "macro_food" USING btree ("category","brand");--> statement-breakpoint
-- Retire the 'custom' source value (ingredient-registry provenance expansion): existing custom
-- foods were Claude/Curtis-defined without a label, so 'estimated' is their honest provenance.
UPDATE "macro_food" SET "source" = 'estimated' WHERE "source" = 'custom';