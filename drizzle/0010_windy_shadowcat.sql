CREATE TABLE "ride" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"file_hash" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"blob_key" text NOT NULL,
	"device_manufacturer" text,
	"device_product" text,
	"device_serial" text,
	"sport" text NOT NULL,
	"sub_sport" text,
	"sport_profile_name" text,
	"elapsed_seconds" real NOT NULL,
	"moving_seconds" real NOT NULL,
	"distance_meters" real,
	"total_ascent_meters" real,
	"total_descent_meters" real,
	"avg_power_watts" real,
	"max_power_watts" real,
	"normalized_power_watts" real,
	"avg_heart_rate" integer,
	"max_heart_rate" integer,
	"avg_cadence" real,
	"max_cadence" real,
	"avg_speed_mps" real,
	"max_speed_mps" real,
	"calories" integer,
	"avg_temperature_c" real,
	"time_in_hr_zone" jsonb,
	"raw_session" jsonb,
	"name" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "ride_stream" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ride_id" uuid NOT NULL,
	"resolution_seconds" integer NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ride_stream" ADD CONSTRAINT "ride_stream_ride_id_ride_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."ride"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ride_started_at_idx" ON "ride" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "ride_sport_idx" ON "ride" USING btree ("sport");--> statement-breakpoint
CREATE UNIQUE INDEX "ride_file_hash_key" ON "ride" USING btree ("file_hash") WHERE "ride"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "ride_started_at_device_serial_key" ON "ride" USING btree ("started_at","device_serial") WHERE "ride"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "ride_stream_ride_id_key" ON "ride_stream" USING btree ("ride_id");