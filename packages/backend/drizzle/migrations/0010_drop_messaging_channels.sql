ALTER TABLE "messaging_channels" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messaging_messages" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "messaging_channels" CASCADE;--> statement-breakpoint
DROP TABLE "messaging_messages" CASCADE;--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_channel_id_messaging_channels_id_fk";
--> statement-breakpoint
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_channel_id_messaging_channels_id_fk";
--> statement-breakpoint
ALTER TABLE "polls" DROP CONSTRAINT "polls_channel_id_messaging_channels_id_fk";
--> statement-breakpoint
ALTER TABLE "todo_lists" DROP CONSTRAINT "todo_lists_channel_id_messaging_channels_id_fk";
--> statement-breakpoint
DROP TYPE "public"."channel_type";