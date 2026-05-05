ALTER TABLE "events" DROP COLUMN IF EXISTS "channel_id";--> statement-breakpoint
ALTER TABLE "expenses" DROP COLUMN IF EXISTS "channel_id";--> statement-breakpoint
ALTER TABLE "polls" DROP COLUMN IF EXISTS "channel_id";--> statement-breakpoint
ALTER TABLE "todo_lists" DROP COLUMN IF EXISTS "channel_id";