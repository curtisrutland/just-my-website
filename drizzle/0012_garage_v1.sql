CREATE TABLE "garage_bike" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" text NOT NULL,
	"brand" text NOT NULL,
	"model" text NOT NULL,
	"model_year" integer NOT NULL,
	"note" text,
	"retired_on" date
);
--> statement-breakpoint
CREATE TABLE "garage_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"profile" text NOT NULL,
	"bike_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "garage_ride" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"activity_id" uuid NOT NULL,
	"bike_id" uuid NOT NULL,
	"assigned_by" text NOT NULL,
	"reason" text,
	"local_date" date NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"sport_profile_name" text,
	"moving_seconds" real NOT NULL,
	"distance_meters" real
);
--> statement-breakpoint
ALTER TABLE "garage_profile" ADD CONSTRAINT "garage_profile_bike_id_garage_bike_id_fk" FOREIGN KEY ("bike_id") REFERENCES "public"."garage_bike"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garage_ride" ADD CONSTRAINT "garage_ride_bike_id_garage_bike_id_fk" FOREIGN KEY ("bike_id") REFERENCES "public"."garage_bike"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "garage_bike_name_key" ON "garage_bike" USING btree (lower("name")) WHERE "garage_bike"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "garage_profile_profile_key" ON "garage_profile" USING btree (lower("profile")) WHERE "garage_profile"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "garage_ride_activity_key" ON "garage_ride" USING btree ("activity_id") WHERE "garage_ride"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "garage_ride_bike_idx" ON "garage_ride" USING btree ("bike_id","local_date") WHERE "garage_ride"."deleted_at" is null;