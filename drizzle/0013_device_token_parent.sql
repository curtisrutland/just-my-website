ALTER TABLE "device_tokens" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
CREATE INDEX "device_tokens_parent_id_idx" ON "device_tokens" USING btree ("parent_id");