CREATE TABLE "oauth_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" text NOT NULL,
	"client_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"resource" text NOT NULL,
	"scopes" text[] NOT NULL,
	"code_hash" text NOT NULL,
	"code_challenge" text NOT NULL,
	"code_expires_at" timestamp with time zone NOT NULL,
	"code_used_at" timestamp with time zone,
	"access_hash" text,
	"access_expires_at" timestamp with time zone,
	"refresh_hash" text,
	"prev_refresh_hash" text,
	"refresh_rotated_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_grants_code_hash_idx" ON "oauth_grants" USING btree ("code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_grants_access_hash_idx" ON "oauth_grants" USING btree ("access_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_grants_refresh_hash_idx" ON "oauth_grants" USING btree ("refresh_hash");--> statement-breakpoint
CREATE INDEX "oauth_grants_prev_refresh_hash_idx" ON "oauth_grants" USING btree ("prev_refresh_hash");