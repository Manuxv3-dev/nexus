CREATE TYPE "public"."channel_type" AS ENUM('text', 'dm', 'group_dm');--> statement-breakpoint
CREATE TYPE "public"."provider_session_status" AS ENUM('connecting', 'connected', 'disconnected', 'error');--> statement-breakpoint
CREATE TYPE "public"."provider_type" AS ENUM('discord', 'whatsapp', 'messenger');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messaging_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"external_channel_id" text NOT NULL,
	"name" text NOT NULL,
	"channel_type" "channel_type" NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messaging_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"external_message_id" text NOT NULL,
	"external_author_id" text NOT NULL,
	"author_display_name" text NOT NULL,
	"author_avatar_url" text,
	"content" text NOT NULL,
	"reply_to_external_id" text,
	"attachments" jsonb,
	"reactions" jsonb,
	"is_edited" boolean DEFAULT false NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"external_created_at" timestamp with time zone NOT NULL,
	"external_edited_at" timestamp with time zone,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messaging_provider_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"provider_type" "provider_type" NOT NULL,
	"external_id" text NOT NULL,
	"display_name" text NOT NULL,
	"encrypted_credentials" "bytea",
	"status" "provider_session_status" DEFAULT 'connecting' NOT NULL,
	"status_detail" text,
	"last_connected_at" timestamp with time zone,
	"last_error" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messaging_channels" ADD CONSTRAINT "messaging_channels_session_id_messaging_provider_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."messaging_provider_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messaging_messages" ADD CONSTRAINT "messaging_messages_channel_id_messaging_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."messaging_channels"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messaging_provider_sessions" ADD CONSTRAINT "messaging_provider_sessions_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messaging_provider_sessions" ADD CONSTRAINT "messaging_provider_sessions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messaging_channels_session_external_idx" ON "messaging_channels" USING btree ("session_id","external_channel_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messaging_channels_session_idx" ON "messaging_channels" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messaging_messages_channel_external_idx" ON "messaging_messages" USING btree ("channel_id","external_message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messaging_messages_channel_created_idx" ON "messaging_messages" USING btree ("channel_id","external_created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messaging_sessions_provider_external_idx" ON "messaging_provider_sessions" USING btree ("provider_type","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messaging_sessions_group_idx" ON "messaging_provider_sessions" USING btree ("group_id");