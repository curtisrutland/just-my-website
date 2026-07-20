CREATE TABLE "lifting_exercise" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"session_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"exercise_template_id" text,
	"title" text NOT NULL,
	"notes" text,
	"superset_group" integer
);
--> statement-breakpoint
CREATE TABLE "lifting_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"hevy_id" text NOT NULL,
	"title" text,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"description" text,
	"hevy_updated_at" timestamp with time zone,
	"raw_payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lifting_session_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"session_id" uuid NOT NULL,
	"session_notes" text,
	"interpretation" text,
	"interpreted_at" timestamp with time zone,
	"focus" text,
	"quality" integer
);
--> statement-breakpoint
CREATE TABLE "lifting_set" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exercise_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"set_type" text NOT NULL,
	"weight_kg" real,
	"reps" integer,
	"rpe" real,
	"distance_meters" real,
	"duration_seconds" integer
);
--> statement-breakpoint
ALTER TABLE "lifting_exercise" ADD CONSTRAINT "lifting_exercise_session_id_lifting_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."lifting_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifting_session_note" ADD CONSTRAINT "lifting_session_note_session_id_lifting_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."lifting_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifting_set" ADD CONSTRAINT "lifting_set_exercise_id_lifting_exercise_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."lifting_exercise"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifting_set" ADD CONSTRAINT "lifting_set_session_id_lifting_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."lifting_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lifting_exercise_session_id_index_idx" ON "lifting_exercise" USING btree ("session_id","index");--> statement-breakpoint
CREATE INDEX "lifting_exercise_template_id_idx" ON "lifting_exercise" USING btree ("exercise_template_id");--> statement-breakpoint
CREATE INDEX "lifting_session_started_at_idx" ON "lifting_session" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lifting_session_hevy_id_key" ON "lifting_session" USING btree ("hevy_id") WHERE "lifting_session"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "lifting_session_note_session_id_key" ON "lifting_session_note" USING btree ("session_id") WHERE "lifting_session_note"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "lifting_set_exercise_id_idx" ON "lifting_set" USING btree ("exercise_id");