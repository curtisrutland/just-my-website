CREATE TABLE "weight_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"measured_on" date NOT NULL,
	"weight" real NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE INDEX "weight_entry_measured_on_idx" ON "weight_entry" USING btree ("measured_on");--> statement-breakpoint
CREATE UNIQUE INDEX "weight_entry_measured_on_key" ON "weight_entry" USING btree ("measured_on") WHERE "weight_entry"."deleted_at" is null;